// scripts/local-stack.mjs - Seed local anvil chain with rich states for Pawn (Spec §5)
import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const ANVIL_PORT = 8769;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

// Dev accounts
const lenderAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const borrowerAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const outsiderAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

async function main() {
  console.log(`Starting Anvil on port ${ANVIL_PORT}...`);
  const anvil = spawn("anvil", ["-p", String(ANVIL_PORT), "--silent"]);
  await new Promise((r) => setTimeout(r, 1500));

  console.log("Deploying Pawn and MockToken...");
  const deployOutput = await new Promise((resolve, reject) => {
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

  const pMatch = deployOutput.match(/contract Pawn (0x[a-fA-F0-9]{40})/);
  if (!pMatch) throw new Error("Could not find deployed Pawn address");
  const pawnAddress = pMatch[1];
  console.log(`Pawn deployed at: ${pawnAddress}`);

  // Deploy MockToken
  const tokenDeployOutput = await new Promise((resolve, reject) => {
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
      else reject(new Error(`MockToken deploy failed: ${out}`));
    });
  });

  const tMatch = tokenDeployOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/i);
  if (!tMatch) throw new Error("Could not find deployed MockToken address");
  const tokenAddress = tMatch[1];
  console.log(`MockToken deployed at: ${tokenAddress}`);

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const lenderWallet = createWalletClient({ account: lenderAccount, transport: http(RPC_URL) });
  const borrowerWallet = createWalletClient({ account: borrowerAccount, transport: http(RPC_URL) });

  const pawnAbi = JSON.parse(readFileSync("contracts/out/Pawn.sol/Pawn.json", "utf8")).abi;
  const tokenAbi = JSON.parse(readFileSync("contracts/out/Pawn.t.sol/MockToken.json", "utf8")).abi;

  // Mint tokens to borrower so they have tokens and no allowance for offer 1 (Spec §5)
  console.log("Minting tokens to borrower...");
  await lenderWallet.writeContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "mint",
    args: [borrowerAccount.address, 100_000n * 10n ** 18n],
  });

  const collateral = 10_000n * 10n ** 18n;
  const principal = parseEther("5");
  const interest = parseEther("0.5");

  console.log("Creating Offer 1: Open offer ready for 3-step walkthrough...");
  await lenderWallet.writeContract({
    address: pawnAddress,
    abi: pawnAbi,
    functionName: "offer",
    args: [tokenAddress, collateral, interest, 86400n * 30n, 86400n * 7n],
    value: principal,
  });

  console.log("Local stack ready! Press Ctrl+C to terminate.");
  process.on("SIGINT", () => {
    anvil.kill();
    process.exit();
  });
}

main().catch((err) => {
  console.error("Local stack error:", err);
  process.exit(1);
});
