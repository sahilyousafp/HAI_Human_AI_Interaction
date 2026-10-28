## ADDED Requirements

### Requirement: Listening comes before speaking
While the microphone is open for the user, the voice SHALL be silent. Opening it SHALL stop the voice at once, and the rest of the reply that was being spoken, and any reply that arrives meanwhile, SHALL NOT be spoken. A reply stopped by Stop SHALL NOT go on speaking when more of it arrives. The chat SHALL mark where a reply was cut, with the number of words said, and offer to read the rest aloud, which SHALL speak it from the sentence that was cut once the user has finished talking.

#### Scenario: Hold to talk over a reply
- **WHEN** the agent is speaking and the user holds a pinch to talk
- **THEN** the voice stops at once, the rest is not spoken, and the chat says "Interrupted after N words" with Read the rest aloud

### Requirement: Only the start of a reply is spoken
At most three sentences of a reply SHALL be spoken; the rest SHALL be left to read.

#### Scenario: A long reply
- **WHEN** a reply has five sentences
- **THEN** the first three are spoken
