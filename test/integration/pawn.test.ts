import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PAWN_ABI, ERC20_ABI } from "../../lib/botchain/abi";

const ANVIL_PORT = 8669;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

const localChain = defineChain({
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
});

const lenderAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const borrowerAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("Pawn integration lifecycle tests (Anvil)", () => {
  let anvilProcess: ChildProcess;
  let pawnAddress: `0x${string}`;
  let tokenAddress: `0x${string}`;

  const publicClient = createPublicClient({
    chain: localChain,
    transport: http(RPC_URL),
  });

  const lenderWallet = createWalletClient({
    account: lenderAccount,
    chain: localChain,
    transport: http(RPC_URL),
  });

  const borrowerWallet = createWalletClient({
    account: borrowerAccount,
    chain: localChain,
    transport: http(RPC_URL),
  });

  beforeAll(async () => {
    anvilProcess = spawn("anvil", ["-p", String(ANVIL_PORT), "--silent"]);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // 1. Deploy Pawn contract
    const deployOutput = await new Promise<string>((resolve, reject) => {
      const proc = spawn(
        "forge",
        [
          "script",
          "script/Deploy.s.sol",
          "--rpc-url",
          RPC_URL,
          "--broadcast",
          "--private-key",
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ],
        { cwd: "contracts" }
      );
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (out += d.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`Deploy script failed: ${out}`));
      });
    });

    const match = deployOutput.match(/contract Pawn (0x[a-fA-F0-9]{40})/);
    if (!match) throw new Error("Could not find deployed Pawn address");
    pawnAddress = match[1] as `0x${string}`;

    // 2. Deploy MockToken using forge create --broadcast
    const tokenDeployOutput = await new Promise<string>((resolve, reject) => {
      const proc = spawn(
        "forge",
        [
          "create",
          "test/Pawn.t.sol:MockToken",
          "--rpc-url",
          RPC_URL,
          "--broadcast",
          "--private-key",
          "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        ],
        { cwd: "contracts" }
      );
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.stderr.on("data", (d) => (out += d.toString()));
      proc.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`Token deploy failed with code ${code}: ${out}`));
      });
    });

    const tMatch = tokenDeployOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/i);
    if (!tMatch) throw new Error(`Could not find deployed MockToken address in: ${tokenDeployOutput}`);
    tokenAddress = tMatch[1] as `0x${string}`;

    // Mint tokens to borrower
    const mintHash = await lenderWallet.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [borrowerAccount.address, 100_000n * 10n ** 18n],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
  }, 35000);

  afterAll(() => {
    if (anvilProcess) anvilProcess.kill();
  });

  it("completes the full flow: offer -> approve -> take -> withdraw -> repay -> lender withdraw", async () => {
    const principal = parseEther("5");
    const interest = parseEther("0.5");
    const collateral = 10_000n * 10n ** 18n;
    const termSecs = 86400n * 30n;
    const offerSecs = 86400n * 7n;

    // 1. Lender posts offer
    const offerHash = await lenderWallet.writeContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "offer",
      args: [tokenAddress, collateral, interest, termSecs, offerSecs],
      value: principal,
    });
    await publicClient.waitForTransactionReceipt({ hash: offerHash });

    const loan1 = await publicClient.readContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "loanOf",
      args: [1n],
    });
    expect(loan1.principal).toBe(principal);
    expect(loan1.collateral).toBe(collateral);

    // 2. Borrower approves token collateral to Pawn
    const appHash = await borrowerWallet.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [pawnAddress, collateral],
    });
    await publicClient.waitForTransactionReceipt({ hash: appHash });

    // 3. Borrower takes the loan
    const takeHash = await borrowerWallet.writeContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "take",
      args: [1n],
    });
    await publicClient.waitForTransactionReceipt({ hash: takeHash });

    // Borrower pending should have principal (5 BOT)
    const borrowerPending = await publicClient.readContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "pending",
      args: [borrowerAccount.address],
    });
    expect(borrowerPending).toBe(principal);

    // Pawn contract now holds the collateral
    const contractCollateral = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [pawnAddress],
    });
    expect(contractCollateral).toBe(collateral);

    // 4. Borrower withdraws the borrowed principal
    const bWithdrawHash = await borrowerWallet.writeContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "withdraw",
      args: [],
    });
    await publicClient.waitForTransactionReceipt({ hash: bWithdrawHash });

    // 5. Borrower repays principal + interest (5.5 BOT)
    const repayHash = await borrowerWallet.writeContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "repay",
      args: [1n],
      value: principal + interest,
    });
    await publicClient.waitForTransactionReceipt({ hash: repayHash });

    // Collateral returned to borrower
    const contractCollateralAfter = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [pawnAddress],
    });
    expect(contractCollateralAfter).toBe(0n);

    // Lender pending has 5.5 BOT
    const lenderPending = await publicClient.readContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "pending",
      args: [lenderAccount.address],
    });
    expect(lenderPending).toBe(principal + interest);

    // 6. Lender withdraws funds
    const lWithdrawHash = await lenderWallet.writeContract({
      address: pawnAddress,
      abi: PAWN_ABI,
      functionName: "withdraw",
      args: [],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: lWithdrawHash });
    expect(receipt.status).toBe("success");
  }, 40000);
});
