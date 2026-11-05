// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";
import "../src/Pawn.sol";

contract Deploy is Script {
  function run() external returns (Pawn pawn) {
    vm.startBroadcast();
    pawn = new Pawn();
    vm.stopBroadcast();
  }
}
