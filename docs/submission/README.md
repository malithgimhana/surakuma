# Local assessment materials

Prepared 22 October 2026. Identity and contribution fields are deliberately blank as requested. This is a submission preparation package; complete human reviews and live provider checks before presenting it as fully validated.

## Materials

- `output/pdf/Surakuma-technical-report.pdf`: formatted report with architectural reasoning, code-based patterns, diagrams, evidence and limitations.
- `output/docx/Surakuma-technical-report.docx`: editable report; fill cover details, actual contributions and reflections, then export an updated PDF.
- `docs/diagrams/rendered`: editable SVG figures and PNG exports. Mermaid/PlantUML sources remain under `docs/diagrams`.
- `output/demo/Surakuma-walkthrough.webm`: actual silent browser walkthrough with captions, using synthetic data, AI fallback and email capture.
- `output/demo/index.html`: local video player; keep it beside the WebM and transcript.
- `output/demo/walkthrough-transcript.md`: approximate chapter times and explanation of preparation.
- `translation-review.csv`: all 169 current language keys; reviewer/date/approval/correction fields are blank.
- `uat-review.md`: participant tasks, expected outcomes and unexecuted result fields.
- `contribution-record.csv`: blank evidence-based contribution log.
- `presentation-handover.md`: module workflows, UI/API/database/test pointers and questions for lecturers.

## Report design and layout verification

The 22 October redesign follows the application theme: navy typography, coral section numbers, blue captions, teal subheadings, pastel diagrams and alternating table rows. The illustrated cover includes the Sinhala project name and leaves all identity fields blank. Technical content and implementation limitations are preserved.

The 21-page Word report was exported with Microsoft Word, rendered through the document renderer and Poppler, and all 21 page images were visually inspected for readable labels, intact tables, page boundaries and Sinhala cover rendering. This is document layout verification; it does not add application test results or human approval.

## Human work still required

1. Fill names, IDs, programme, institution and lecturer details in the editable report.
2. Review critical Sinhala/Tamil wording and public free text with native speakers; record real approvals.
3. Run participant UAT and assistive-technology checks; record observations and retests.
4. Record actual contributions and references; assign presentation duties without claiming implementation authorship for presentation alone.
5. Create free provider accounts, verify the sender, configure keys locally and execute live synthetic tests using docs/integrations.md. This package contains no keys.
6. Review the video; add personal narration or a new presentation recording if required. The local file works without a hosted link. If a lecturer link is required, upload the reviewed file and verify viewing permissions.
7. After edits and reviews, regenerate the final PDF and run scripts/Package-Submission.ps1.

## Rebuild report and recording

The authoring source is scripts/build_assessment.py. It creates SVG figures by default, and creates the DOCX with `--document` after `scripts/render_diagrams.cjs` converts SVGs to PNGs using Sharp. Python requires python-docx; the diagram rasteriser requires Node and Sharp. The Codex bundled runtimes were used for this generated package.

`scripts/Export-Report.ps1` exports with a dedicated hidden instance of installed Microsoft Word. LibreOffice is absent on the build machine. `scripts/render_report.py` uses the document skill's render_docx.py page-rendering pipeline with that Word PDF, then Poppler produces page PNGs for inspection. The script does not alter the managed skill package.

To record again, start both application servers, use `scripts/Start-Api.ps1 -BrowserTests`, then `npm run demo:record` from frontend. The script reads the ignored local seed password, never prints tokens/passwords, prepares its own synthetic data and records real UI actions. It requires the default synthetic organisation/crisis and an available verified distribution volunteer. It intentionally refuses to record with live email or external AI configured. It does not reset existing data. Restart the API normally after recording/testing.

The report authoring source remains editable, but regenerating it will replace manual changes to the generated DOCX. Treat the edited DOCX as authoritative if you fill it manually; export it again with Export-Report.ps1 rather than rerunning the builder.
