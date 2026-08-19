# Persona Builder Studio UX audit

Audit date: August 19, 2026

## Goal

Make the three-stage workflow—research, personas, and prompt taxonomy—obvious on first use, reduce competing controls, and keep advanced or destructive work out of the primary path.

## What was reviewed

- Sign-in and demo access
- Project list and project creation
- Research upload, source processing, audience definition, and persona generation
- Persona review, export, and editing
- Prompt-taxonomy setup, generation, preview, and export
- Desktop and phone layouts
- Keyboard and semantic navigation structure
- Empty, ready, running, warning, and failure states in code

## Findings and changes

### Navigation competed with the workflow

The previous layout used a large dark masthead, a persistent sidebar, and a separate row of project tabs. The sidebar contained only two destinations and consumed valuable space.

**Resolved:** Replaced the masthead and sidebar with one compact top bar. Kept the project workflow as a full-width, three-step control and shortened its phone label to “Prompts.” Removed role and email metadata from the persistent interface while retaining sign-out and integration access.

### Primary actions were duplicated

Persona generation appeared on both the Data and Personas screens. Workbook downloads appeared twice on the Prompt Taxonomy screen. A disabled download button was also shown before a workbook existed.

**Resolved:** Persona generation now lives in the Data stage, export and continue actions live in Personas, and generation/download actions appear once at the top of Prompt Taxonomy. Unavailable actions stay hidden until they are useful.

### Status metrics overwhelmed the task

Rows of metric cards repeated information already present in sources, personas, and prompt results. Revision numbers and internal run state were prominent even when no action was required.

**Resolved:** Replaced metric grids with one concise readiness summary on Data and one workbook-ready summary on Prompt Taxonomy. Technical revision data remains available only where it supports warnings or recovery.

### Advanced content made review pages too long

Persona evidence metadata was repeated beside every insight, and the prompt setup exposed every workbook field at once.

**Resolved:** The client-ready persona profile stays open while research, audience, detailed evidence, and editing sections use progressive disclosure. Prompt setup collapses when a workbook is ready, and aliases, tracking details, and entity checks sit under Advanced workbook options.

### Destructive and low-value controls were too prominent

Project deletion appeared as an ambiguous red “X” beside each project. Manual status refresh and decorative arrows inside buttons added controls or motion without advancing the workflow.

**Resolved:** Removed the delete icon from the primary project card and moved the explicit Delete project action behind Project options with a confirmation. Source and generation status now refresh automatically while work is active. Buttons no longer grow or reveal decorative arrows on hover.

### Project creation asked for secondary choices too early

Market and language were given the same visual weight as project name, domain, and product description.

**Resolved:** Kept sensible defaults and moved market/language into an optional disclosure while preserving the full configuration.

## Verification

- Desktop review at 1280 × 720
- Phone review at 390 × 844
- Prettier formatting check
- ESLint
- TypeScript type check
- 26 unit tests
- 6 database integration tests
- 2 full browser workflow tests, including project creation, upload, persona generation/editing/export, taxonomy generation, and workbook export

## Recommended follow-up

Run five short usability sessions with first-time strategists and measure time to first completed persona set, setup-field error rate, and successful workbook export. The interface is substantially simpler now; this observation step will validate terminology and defaults with the actual audience.
