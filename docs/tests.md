# Testing strategy

Currently we have two kinds of tests: unit-tests and integrational ones.
This separation is quite vague, though, because both kinds of tests use several contracts during their operation.
Integrational tests (located in `/test/integrational`) cover more complex mechanics like simulating tender offer distribution with fees as well as randomized property tests.
Unit tests (`/test/*.js`) focus more on catching bugs in certain components, although the contracts may call other contracts in process.

We use OpenZeppelin test library to test our contracts.
Contrary to a somewhat more conventional Truffle, it does not provide a "clean room environment", i.e. it doesn't redeploy the contracts automatically, and it doesn't require a dedicated test runner – we use `mocha`.

## Unit tests
We try to cover the the basic functionality and the corner cases for our contracts with unit tests.
There is a separate test file for each of our contracts:
1. Multisig
2. Registry
3. BlendToken
4. Orchestrator

Multisig tests target two main methods that require a majority vote – `call` and `rotateKeys`.
For each of the methods, we check the successful scenario and all the possible failures.
We check for invalid signatures in different positions – at the beginning, somewhere in the middle and at the end of the signatures list.
Note that since our Multisig requires signers' addresses to be sorted, we extract the evil accounts from sorted accounts list in advance (see `splitAccounts`).

Registry tests cover the functionality described in the [specification](./specification.md).
Registry tests are just regular unit tests: they do not require any other contracts to be present.
In these tests, we pay special attention to fees computation during burn dispatching.

BlendToken tests, in turn, require Registry to be deployed because BlendToken relies on Registry's functionality.
In BlendToken tests we cover transfers, phases, unlocks and burns.
We make sure that BlendToken correctly updates its state upon these operations, and we also ensure that Registry errors correctly revert the whole transaction instead of leaving the system in an inconsistent state.

Orchestrator tests, apart from covering the basic functionality defined in the specification, focus on distribution logic.
We, however, test for most straightforward cases to make sure the test time is reasonably bound.
Complex distribution logic (like deducing a burn fee or ensuring the correctness via randomized test scenarios) is moved to a integrational tests.

## Integrational tests

Integrational tests consist of two main parts: ensuring fees are deduced correctly, and running randomized distribution tests.

The former (see "Fee & burn dispatching") simulates executing two orders submitted by the same person, with different price and amount.
For various initial conditions ("internal balances" of addresses on a tender address), we check that the deduced fee corresponds to the one we expect.
We also check that the remaining "internal balances" do indeed match the expected values according to the specification.

The second block of integrational tests cover different orderbook structures.
We check that independently of the tender address, redeemer address, price, and amount, the resulting BLEND and USDC balances after execution match our expectations.
We use a separate `Scenario` class to take care of the boilerplate – doing proper initialization, checking balances of the addresses, etc.
Currently, we use `Math.random` to generate randomness for our tests.
In the future, we plan to move to a deterministic RNG or a QuickCheck-like library (e.g., `fast-check`) so that the errors of our randomized tests are reproducible.
