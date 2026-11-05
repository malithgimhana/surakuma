# Surakuma assessment materials

This single ZIP contains the local prototype source, an editable technical report and PDF, a real recorded browser walkthrough, and blank human-review records. It was prepared on 22 October 2026. It is not labelled as fully approved for submission: the checklist below remains outstanding.

## Open the materials

1. Extract `prototype/Surakuma-source.zip` into a project directory. Follow its README or `SETUP.md` to install dependencies, create/migrate SQL Server and generate local development credentials. Existing private settings are intentionally excluded.
2. Open `report/Surakuma-technical-report.docx` to fill your institution, programme, lecturer, names/IDs and actual contributions. Export the updated version as PDF before final submission. The supplied PDF contains the requested blank fields.
3. Open `demonstration/index.html` locally, or play `demonstration/Surakuma-walkthrough.webm` in a browser/media player. Keep the WebM beside index.html. The silent recording has captions and a timed Markdown transcript. Pause to inspect steps.
4. Use `review/translation-review.csv`, `review/uat-review.md`, `review/contribution-record.csv` and `review/presentation-handover.md` for actual review sessions and presentation preparation.
5. `PACKAGE-MANIFEST.txt` lists hashes for the packaged files. The source archive includes schema/setup, API documentation, test code, executed results, diagrams and screenshots.

## What the recording demonstrates

Synthetic flood request; human AI priority override; duplicate review; stock shortage rejection; partial aid and replenishment; a separate accessible shelter need; volunteer assignment and staff verification; citizen receipt feedback; persisted notifications; metrics and audit. AI is explicitly the deterministic fallback. Email is captured locally, not sent. Live authenticated routing is unconfigured.

## Complete before institutional submission

- Fill requested identity and actual contribution fields.
- Complete native-speaker Sinhala/Tamil review, staff-entered public-text review and participant UAT/assistive-technology checks.
- Create the free provider accounts and perform authorised synthetic live AI, verified-sender email and routing tests; record evidence honestly.
- Review the report and recording against lecturer requirements. Add narration or upload a lecturer-viewable link if required, and test permissions. No remote viewing link is included or claimed.
- Rebuild the package after final edits and reviews.

Do not include API keys, generated development passwords, private attachments or runtime settings in the final submission.
