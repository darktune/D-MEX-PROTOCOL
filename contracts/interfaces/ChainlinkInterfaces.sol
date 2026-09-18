// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface AggregatorV3Interface {
  function latestRoundData()
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

abstract contract FunctionsClient {
  error OnlyRouterCanFulfill();

  address internal s_oracle;
  
  function sendRequest(
    bytes memory req,
    uint64 subscriptionId,
    uint32 gasLimit,
    bytes32 donId
  ) internal returns (bytes32) {
      return keccak256(req);
  }

  function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal virtual;
}
