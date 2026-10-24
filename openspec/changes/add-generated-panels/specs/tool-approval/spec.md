## ADDED Requirements

### Requirement: Panel tools are pre-approved and gated by the user's acceptance
Calls to the panel tools (offering, supplying, replacing and closing a panel) SHALL run without an approval card, because the user's acceptance of an offer is the consent and a panel can only send validated scene operations. Supplying a first panel SHALL be refused unless the user has accepted an offer that has not yet been used, and the refusal SHALL tell the agent to offer a panel first. Replacing or closing the panel that is already open needs no new offer.

#### Scenario: Offer runs without an approval card
- **WHEN** the agent offers a panel
- **THEN** no approval card is shown, only the offer card

#### Scenario: Supplying needs an accepted offer
- **GIVEN** the user skipped the agent's offer
- **WHEN** the agent supplies a panel anyway
- **THEN** no panel opens and the agent is told to offer one first

#### Scenario: Acceptance is used once
- **GIVEN** the user accepted an offer and the agent supplied a panel that is now closed
- **WHEN** the agent supplies another panel without a new offer
- **THEN** it is refused
