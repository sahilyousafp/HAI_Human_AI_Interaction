# Spec Delta

## ADDED Requirements

### Requirement: Python tools go to the agents that should have them
The agents that change the model (Architect, Product) SHALL be able to use all three Rhino and Python tools. Climate SHALL be able to use the managed-environment tool and the read tool, because analysis only writes files. Reviewer SHALL be able to use the read tool only. The bridge SHALL offer an agent only the tools its definition lists, as for the other tools, and the Rhino run tool SHALL NOT be offered to an agent not marked as changing the model.

#### Scenario: Roles get their tools
- **WHEN** each default agent's session lists its tools
- **THEN** Architect and Product have the Rhino run tool, the Python workbench tool and the Rhino read tool, Climate has the workbench tool and the read tool, and Reviewer has only the read tool

#### Scenario: Reviewer cannot run Python
- **WHEN** Reviewer's session calls the Rhino run tool or the workbench tool
- **THEN** the bridge refuses the call because the tool is not in its definition
