## ADDED Requirements

### Requirement: A waiting request is shown in the model
A permission request that waits for the user SHALL also be shown as a badge in the model, in the colour of the asking agent, over the top middle of what the request concerns: the elements named in its input, else the elements the agent owns, else the whole model. A pinch on the badge SHALL open a tag with the question, a short summary, Allow and Deny. The nod and the shake SHALL answer the only waiting request without the badge being opened. A request that runs a script SHALL NOT offer Allow in the tag; it SHALL send the user to the card in the chat, where the whole script is shown.

#### Scenario: Allow from the tag
- **WHEN** an agent asks to run a tool on two walls and the user opens the badge and presses Allow
- **THEN** the call is allowed, the card in the chat shows Allowed and the badge goes

#### Scenario: A script
- **WHEN** an agent asks to run a script
- **THEN** the tag offers to show it in the chat and has no Allow button
