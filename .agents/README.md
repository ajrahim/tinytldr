# Working on tinytldr

Start at [AGENTS.md](../AGENTS.md). This folder holds the maintained project context for people and coding agents; it is not application runtime configuration.

| Need                                 | Read                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| Required coding and change rules     | [Engineering contract](instructions/Engineering.md)        |
| Where code and styles belong         | [Architecture and ownership](instructions/Architecture.md) |
| Hooks, contexts and shared state     | [Website state ownership](instructions/StateManagement.md) |
| Which checks to run                  | [Verification](instructions/Verification.md)               |
| Master product & phase plan          | [Build brief](docs/PLAN.md)                                |
| A bounded implementation task        | [Implementation prompt](prompts/Implement.md)              |
| An evidence-based review             | [Review prompt](prompts/Review.md)                         |
| Current capabilities and limitations | [Current state](memory-bank/CurrentState.md)               |
| Reasons behind durable choices       | [Decisions](memory-bank/Decisions.md)                      |
| Feature specifications               | [Specifications](specs/)                                   |

Instructions define rules, specifications define observable behavior, and memory records the current state and its rationale. Prompts reference those sources instead of duplicating them. When a change affects one of these facts, update its owner in the same change. Keep entries concise, source-linked, and safe to publish: no credentials, personal paths, private assets, or chat histories.

Create a new specification only for an actual requested behavior. Record its status, scope, acceptance criteria, compatibility effects, and verification. A proposed specification is not evidence that its behavior exists. Add a decision only when its rationale is useful beyond the immediate change.
