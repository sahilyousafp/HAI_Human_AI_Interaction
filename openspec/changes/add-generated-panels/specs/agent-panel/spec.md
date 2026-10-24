## ADDED Requirements

### Requirement: Panel offers appear as cards
When the agent offers a panel, the turn SHALL show an offer card under the tool's chip with the offer's purpose and Open and Skip buttons. After the card is answered it SHALL show Opened, Skipped or Expired. The collapsed panel header SHALL count a waiting offer together with waiting approvals.

#### Scenario: Waiting offer while collapsed
- **GIVEN** the agent panel is collapsed
- **WHEN** a panel offer is waiting
- **THEN** the header shows "1 to approve"

### Requirement: Offers are answered by nod or shake in a fixed order
While engaged, a nod SHALL open the panel and a shake SHALL skip it, but only while the offer is the only thing waiting for a yes or no. A shake that answers an offer SHALL NOT also cancel the active tool. When several things wait for a yes or no, a nod or shake SHALL answer them in this order: a voice transcript under review, then an approval card, then a panel offer, then any other confirmation.

#### Scenario: Nod opens the panel
- **GIVEN** one waiting offer and the system is engaged
- **WHEN** the user nods
- **THEN** the card shows "Opened" and the panel frame appears

#### Scenario: Shake skips and keeps the tool
- **GIVEN** one waiting offer and the Wall tool is active
- **WHEN** the user shakes their head
- **THEN** the card shows "Skipped" and the Wall tool stays active

#### Scenario: Approval is answered before the offer
- **GIVEN** an approval card and a panel offer are both waiting
- **WHEN** the user nods
- **THEN** the approval is allowed and the offer is still waiting

#### Scenario: Transcript is answered before the offer
- **GIVEN** a voice transcript is under review and a panel offer is waiting
- **WHEN** the user nods
- **THEN** the transcript is sent and the offer is still waiting
