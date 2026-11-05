"""Build editable report and SVG figures from implementation-grounded content.

Run with Python containing python-docx and Pillow, then rasterise the SVGs with
render_diagrams.cjs before passing --document. No credentials or database reads.
"""
from pathlib import Path
import argparse
import html
import textwrap
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[1]
FIGURES = ROOT / "docs/diagrams/rendered"
NAVY = "14284B"
CORAL = "D64A3D"
BLUE = "1769C2"
TEAL = "15775F"
INK = "25354A"
PASTELS = ["#eaf3ff", "#fff0eb", "#e7f7f0", "#f1edff", "#fff6df"]


class Figure:
    def __init__(self, name, width=1000, height=1000):
        self.name, self.width, self.height = name, width, height
        self.box_count = 0
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
                      '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/></marker></defs>',
                      '<rect width="100%" height="100%" fill="white"/>']

    def text(self, x, y, value, size=22, anchor="start", bold=False):
        self.parts.append(f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" text-anchor="{anchor}" font-weight="{700 if bold else 400}" fill="#111827">{html.escape(str(value))}</text>')

    def box(self, x, y, w, h, title, lines=(), fill=None):
        fill = fill or PASTELS[self.box_count % len(PASTELS)]
        self.box_count += 1
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="#a4b7ce" stroke-width="1.5"/>')
        self.text(x + 14, y + 31, title, 22, bold=True)
        if lines:
            self.parts.append(f'<line x1="{x+14}" y1="{y+44}" x2="{x+w-14}" y2="{y+44}" stroke="#b5c6d7"/>')
            for i, line in enumerate(lines):
                self.text(x + 14, y + 74 + i * 28, line, 20)

    def line(self, points, label="", label_pos=None, dashed=False, arrow=True):
        path = " ".join(f'{x},{y}' for x, y in points)
        dash = ' stroke-dasharray="8 6"' if dashed else ''
        marker = ' marker-end="url(#arrow)"' if arrow else ''
        self.parts.append(f'<polyline points="{path}" fill="none" stroke="#334155" stroke-width="2"{dash}{marker}/>')
        if label and label_pos:
            self.text(*label_pos, label, 19, anchor="middle")

    def save(self):
        FIGURES.mkdir(parents=True, exist_ok=True)
        (FIGURES / (self.name + ".svg")).write_text("\n".join(self.parts + ['</svg>']), encoding="utf-8")


def diagrams():
    # Original code-native artwork echoes the app's rounded pastel visual language.
    FIGURES.mkdir(parents=True, exist_ok=True)
    (FIGURES / "report-cover.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="390" viewBox="0 0 1400 390">
    <rect width="1400" height="390" rx="40" fill="#eaf3ff"/>
    <circle cx="1300" cy="30" r="215" fill="#e5f5ee"/><circle cx="90" cy="370" r="210" fill="#f1edff"/>
    <path d="M0 330 Q210 180 400 300 T800 280 T1400 280 V390 H0Z" fill="#d5e9fa"/>
    <path d="M165 200 Q400 70 700 200 T1235 200" fill="none" stroke="#a8c5e8" stroke-width="5" stroke-dasharray="10 12"/>
    <circle cx="220" cy="190" r="107" fill="#fff6df"/><circle cx="700" cy="190" r="107" fill="#ffe5df"/><circle cx="1180" cy="190" r="107" fill="#d4f2e5"/>
    <path d="M150 180 L220 121 L290 180 M165 172 V245 H275 V172" fill="#ffbf47" stroke="#e99d14" stroke-width="9" stroke-linejoin="round"/>
    <rect x="206" y="204" width="30" height="43" rx="4" fill="white"/>
    <path d="M700 247 L641 192 C601 148 654 111 700 156 C746 111 799 148 759 192Z" fill="#ff6958"/>
    <path d="M1163 120 C1163 120 1109 184 1125 217 C1145 263 1219 258 1235 216 C1247 181 1200 138 1180 111Z" fill="#18a87b"/>
    <path d="M1150 211 Q1168 236 1195 218" fill="none" stroke="white" stroke-width="9" stroke-linecap="round"/>
    <circle cx="430" cy="95" r="14" fill="#ff8a78"/><circle cx="960" cy="300" r="19" fill="#ffce62"/>
    <circle cx="1050" cy="60" r="9" fill="#7ca9e6"/><circle cx="500" cy="315" r="9" fill="#54bf9a"/>
    </svg>''', encoding="utf-8")
    f = Figure("component", 1000, 940)
    f.box(280, 15, 440, 100, "React browser client", ["Citizen, staff and public workspaces"])
    f.box(280, 180, 440, 100, "ASP.NET Core API", ["Controllers, JWT, validation, Problem Details"])
    f.box(280, 350, 440, 135, "Application", ["Operations and AccessService", "IStore, IAiProvider, IAllocationPolicy"])
    f.box(20, 350, 225, 135, "Domain", ["Case lifecycle", "Stock and capacity"])
    f.box(280, 550, 440, 130, "Infrastructure", ["EfStore, Identity, provider adapters", "SQL outbox NotificationWorker"])
    f.box(20, 750, 280, 110, "SQL Server", ["Cases, history, inventory", "Identity, outbox and audit"])
    f.box(360, 750, 280, 110, "External adapters", ["Gemini, Brevo and ORS", "Fallback or unavailable"])
    f.box(750, 180, 230, 100, "OSM tiles", ["Public online map"])
    for a, b in [((500,115),(500,180)), ((500,280),(500,350)), ((500,485),(500,550)), ((280,417),(245,417))]: f.line([a,b])
    f.line([(400,680),(400,710),(160,710),(160,750)])
    f.line([(580,680),(580,710),(500,710),(500,750)])
    f.line([(720,65),(865,65),(865,180)])
    f.text(500, 914, "Domain and Application do not depend on ASP.NET or EF Core.", 22, "middle")
    f.save()

    f = Figure("classes", 1000, 1090)
    f.box(350,20,300,175,"AssistanceRequest",["Category, Priority, Status", "Quantity, DeliveredQuantity", "Transition(), Deliver()"])
    f.box(20,280,280,160,"Recommendation",["Provider, Model, Fallback", "Confidence nullable", "ReviewState, Explanation"])
    f.box(355,280,290,130,"ResourceAllocation",["RequestId, ResourceId", "Quantity, Status"])
    f.box(700,280,280,130,"ShelterAllocation",["RequestId, ShelterId", "People, Status"])
    f.box(20,570,280,160,"HumanDecision",["RecommendationId", "ActorId, Action, Reason", "FinalPriority nullable"])
    f.box(355,570,290,175,"Resource",["Stock, Reserved, Available", "Reserve(), Dispatch()", "Release()"])
    f.box(700,570,280,175,"Shelter",["Capacity, Reserved", "Occupancy, Available", "Reserve(), CheckIn()", "Release()"])
    f.box(355,890,290,145,"VolunteerTask",["RequestId, VolunteerId", "Title, DueAt, Status"])
    f.box(700,890,280,145,"VolunteerProfile",["UserId, Skills", "Availability", "Verified, Available"])
    f.line([(350,110),(160,110),(160,280)],"1 to many",(220,95))
    f.line([(500,195),(500,280)],"1 to many",(560,247))
    f.line([(650,110),(840,110),(840,280)],"1 to many",(780,95))
    f.line([(160,440),(160,570)],"1 to many",(220,515))
    f.line([(500,570),(500,410)],"1 to many",(560,505))
    f.line([(840,570),(840,410)],"1 to many",(900,505))
    f.line([(650,170),(675,170),(675,815),(500,815),(500,890)],"1 to many",(580,802))
    f.line([(700,970),(645,970)],arrow=False)
    f.text(655,955,"*",18,"middle")
    f.text(690,955,"1",18,"middle")
    f.text(500,1075,"Selected domain classes; Record supplies identity, timestamps and row version.",20,"middle")
    f.save()

    f = Figure("use-cases",1000,1000)
    actors = [(30,85,"Public"),(30,245,"Citizen"),(30,435,"Case manager"),(30,665,"Coordinator"),
              (820,85,"Logistics"),(820,280,"Shelter admin"),(820,490,"Volunteer roles"),(820,725,"Administrator")]
    def actor(x,y,name):
        f.parts.append(f'<circle cx="{x+70}" cy="{y}" r="15" fill="none" stroke="#334155" stroke-width="2"/>')
        f.line([(x+70,y+15),(x+70,y+65)],arrow=False); f.line([(x+40,y+35),(x+100,y+35)],arrow=False)
        f.line([(x+70,y+65),(x+45,y+95)],arrow=False); f.line([(x+70,y+65),(x+95,y+95)],arrow=False)
        f.text(x+70,y+122,name,21,"middle")
    for actor_info in actors: actor(*actor_info)
    f.parts.append('<rect x="260" y="20" width="490" height="910" fill="#f8fafc" stroke="#475569" stroke-width="2"/>')
    f.text(505,53,"Surakuma system boundary",23,"middle",True)
    cases = [(100,["Browse alerts and shelters"]),(210,["Submit and track a request"]),(320,["Verify and review AI"]),(430,["Manage stock and deliver aid"]),(540,["Reserve and check in household"]),(650,["Accept task and verify work"]),(760,["Manage crises and share cases"]),(870,["Manage access and inspect audit"])]
    for index,(y,labels) in enumerate(cases):
        f.parts.append(f'<ellipse cx="505" cy="{y}" rx="215" ry="37" fill="{PASTELS[index % len(PASTELS)]}" stroke="#a4b7ce" stroke-width="2"/>')
        f.text(505,y+8,labels[0],22,"middle")
    for points in [[(130,125),(290,100)],[(130,285),(290,210)],[(130,475),(290,320)],[(130,705),(290,760)],[(820,125),(720,430)],[(820,320),(720,540)],[(820,530),(720,650)],[(820,765),(720,870)]]: f.line(points,arrow=False)
    f.text(500,968,"Case managers escalate; authorised crisis coordinators grant explicit sharing.",20,"middle")
    f.save()

    f = Figure("sequence",1000,1100)
    lanes=[(100,"Citizen"),(300,"API and app"),(500,"SQL"),(700,"Staff and AI"),(900,"Worker/email")]
    for x,title in lanes:
        f.box(x-93,15,186,64,title,fill="#eaf2ff")
        f.line([(x,79),(x,1060)],dashed=True,arrow=False)
    messages=[(100,300,"Submit with stable key"),(300,500,"Request, history, audit, outbox"),(500,100,"Return reference"),
              (700,300,"Verify and request recommendation"),(300,700,"Minimal synthetic text or fallback"),(700,300,"Review with reason then approve"),
              (300,500,"Preserve original and human action"),(700,300,"Reserve partial stock"),(300,500,"Serializable reserve transaction"),
              (700,300,"Dispatch and confirm delivery"),(300,500,"Persist remainder and outbox"),(900,500,"Claim event and deduplicate"),
              (900,900,"Capture or send and save outcome"),(100,300,"View timeline and notification")]
    for i,(a,b,label) in enumerate(messages):
        y=130+i*64
        if a==b: f.line([(a,y),(a+78,y),(a+78,y+28),(a,y+28)])
        else: f.line([(a,y),(b,y)])
        f.text((a+b)/2 if a!=b else 720,y-10,label,19,"middle")
    f.text(500,1084,"AI review never approves or dispatches aid automatically.",22,"middle")
    f.save()

    def er(name, boxes, edges, note):
        f=Figure(name,1000,980)
        coords={}
        for index,(title,lines) in enumerate(boxes):
            col,row=index%3,index//3; x=20+col*330; y=20+row*310
            coords[title]=(x,y); f.box(x,y,300,205,title,lines)
        for source,target in edges:
            sx,sy=coords[source]; tx,ty=coords[target]
            if sx==tx: f.line([(sx+150,sy+205),(tx+150,ty)],"1 to many",(sx+219,(sy+205+ty)/2))
            elif sy==ty: f.line([(sx+300,sy+100),(tx,ty+100)],arrow=False)
            else:
                # Route relationships through row gaps, never through entity fields.
                f.line([(sx+150,sy+205),(sx+150,sy+252),(tx+150,sy+252),(tx+150,ty)],dashed=True)
        for i,line in enumerate(textwrap.wrap(note,90)): f.text(500,950+i*23,line,19,"middle")
        f.save()
    er("er-cases",[
        ("AppUser",["PK Id string", "DisplayName, Language", "Identity password and roles"]),
        ("Organisation",["PK Id Guid", "Name"]),
        ("Crisis",["PK Id Guid", "Name, Type, District", "Active, Latitude, Longitude"]),
        ("Membership",["PK Id Guid", "FK UserId, OrganisationId", "Role", "Unique user + org + role"]),
        ("AssistanceRequest",["PK Id Guid", "FK CitizenId, OrganisationId", "FK CrisisId", "Category, Status, Quantity"]),
        ("CrisisAssignment",["PK Id Guid", "FK UserId, CrisisId", "Unique user + crisis"]),
        ("Household",["PK Id Guid", "FK UserId unique", "Size, AccessibilityNeeds"]),
        ("Recommendation",["PK Id Guid", "FK RequestId", "Provider, Model, Confidence", "Fallback, ReviewState"]),
        ("HumanDecision",["PK Id Guid", "FK RequestId", "FK RecommendationId", "ActorId, Action, Reason", "FinalPriority"])
    ],[("AppUser","Membership"),("Organisation","AssistanceRequest"),("Crisis","CrisisAssignment"),("AssistanceRequest","Recommendation")],
       "Key relationships shown; each FK names its actual parent. Household is one per user. Full FK definitions are in Data.cs and schema.sql.")
    er("er-delivery",[
        ("Resource",["PK Id Guid", "FK OrganisationId", "Category, Stock, Reserved", "Version rowversion"]),
        ("AssistanceRequest",["PK Id Guid", "Quantity, DeliveredQuantity", "HouseholdSize, Status", "Version rowversion"]),
        ("Shelter",["PK Id Guid", "FK OrganisationId", "Capacity, Reserved", "Occupancy, Accessible", "Open"]),
        ("ResourceAllocation",["PK Id Guid", "FK ResourceId, RequestId", "Quantity, Status", "ApprovedBy"]),
        ("VolunteerTask",["PK Id Guid", "FK RequestId, VolunteerId", "RequiredSkill, DueAt, Status", "Note"]),
        ("ShelterAllocation",["PK Id Guid", "FK ShelterId, RequestId", "People, Status", "ApprovedBy"]),
        ("StockMovement",["PK Id Guid", "FK ResourceId", "Quantity, Kind, ActorId", "Note"]),
        ("VolunteerProfile",["PK Id Guid", "FK UserId unique", "OrganisationId, Skills", "Availability, Verified", "Available"]),
        ("NotificationDelivery",["PK Id Guid", "EventId, RecipientId", "State, Provider, Reference", "Unique event + recipient"])
    ],[("Resource","ResourceAllocation"),("AssistanceRequest","VolunteerTask"),("Shelter","ShelterAllocation")],
       "StockMovement belongs to Resource, not ResourceAllocation. Outbox and delivery event IDs correlate in application code; they are not all foreign keys.")


def report():
    doc=Document(); sec=doc.sections[0]
    sec.page_width=Inches(8.5); sec.page_height=Inches(11)
    sec.top_margin=sec.bottom_margin=Inches(.7); sec.left_margin=sec.right_margin=Inches(.75)
    styles=doc.styles
    for name in ["Normal","Title","Subtitle","Heading 1","Heading 2","Heading 3"]:
        styles[name].font.name="Calibri"; styles[name].font.color.rgb=RGBColor.from_string(NAVY)
    styles["Normal"].font.color.rgb=RGBColor.from_string(INK)
    styles["Normal"].font.size=Pt(11)
    styles["Normal"].paragraph_format.space_after=Pt(8)
    styles["Normal"].paragraph_format.line_spacing=1.12
    styles["Title"].font.size=Pt(42); styles["Title"].font.bold=True
    styles["Title"].paragraph_format.space_after=Pt(0)
    styles["Subtitle"].font.size=Pt(17); styles["Subtitle"].font.color.rgb=RGBColor.from_string(INK)
    styles["Subtitle"].paragraph_format.space_after=Pt(9)
    styles["Heading 1"].font.size=Pt(20); styles["Heading 1"].font.bold=True
    styles["Heading 1"].paragraph_format.space_before=Pt(0)
    styles["Heading 1"].paragraph_format.space_after=Pt(13)
    styles["Heading 2"].font.size=Pt(13); styles["Heading 2"].font.color.rgb=RGBColor.from_string(TEAL)
    styles["Caption"].font.color.rgb=RGBColor.from_string(BLUE)
    styles["Caption"].font.size=Pt(9); styles["Caption"].font.italic=False
    sec.different_first_page_header_footer=True
    header=sec.header.paragraphs[0]
    r=header.add_run("SURAKUMA"); r.bold=True; r.font.color.rgb=RGBColor.from_string(CORAL)
    header.add_run("   /   SE205.3 SOFTWARE ARCHITECTURE")
    for r in header.runs: r.font.size=Pt(8)
    footer=sec.footer.paragraphs[0]; footer.alignment=2
    r=footer.add_run("SURAKUMA   /   TECHNICAL REPORT     "); r.font.size=Pt(8); r.font.color.rgb=RGBColor.from_string(BLUE)
    field=OxmlElement("w:fldSimple"); field.set(qn("w:instr"),"PAGE"); footer._p.append(field)
    doc.core_properties.title="Surakuma humanitarian aid coordination technical report"
    doc.core_properties.subject="SE205.3 coursework implementation and evidence"
    doc.core_properties.author=""
    doc.core_properties.comments="Cover and contribution identity fields deliberately left blank at the user's request."

    def p(text): doc.add_paragraph(text)
    section_number=0
    def page(title):
        nonlocal section_number
        section_number += 1
        doc.add_page_break()
        para=doc.add_paragraph(style="Heading 1")
        number=para.add_run(f"{section_number:02d}   "); number.font.color.rgb=RGBColor.from_string(CORAL)
        para.add_run(title)
    def h(title): doc.add_heading(title,level=2)
    def table(headers,rows,widths=None):
        t=doc.add_table(rows=1, cols=len(headers)); t.style="Table Grid"
        t.autofit=False
        borders=OxmlElement("w:tblBorders")
        for side in ["top","left","bottom","right","insideH","insideV"]:
            edge=OxmlElement("w:"+side); edge.set(qn("w:val"),"single"); edge.set(qn("w:sz"),"4"); edge.set(qn("w:color"),"D9E1EB"); borders.append(edge)
        t._tbl.tblPr.append(borders)
        for i,v in enumerate(headers):
            t.rows[0].cells[i].text=v
        repeat=OxmlElement("w:tblHeader"); t.rows[0]._tr.get_or_add_trPr().append(repeat)
        for row in rows:
            cells=t.add_row().cells
            for i,value in enumerate(row): cells[i].text=str(value)
        for row_index,row in enumerate(t.rows):
            for i,cell in enumerate(row.cells):
                if widths: cell.width=Inches(widths[i])
                shade=OxmlElement("w:shd"); shade.set(qn("w:fill"),NAVY if row_index==0 else ("EFF5FC" if row_index%2 else "FFFFFF")); cell._tc.get_or_add_tcPr().append(shade)
                margins=OxmlElement("w:tcMar")
                for side,value in [("top",45),("bottom",45),("left",100),("right",100)]:
                    margin=OxmlElement("w:"+side); margin.set(qn("w:w"),str(value)); margin.set(qn("w:type"),"dxa"); margins.append(margin)
                cell._tc.get_or_add_tcPr().append(margins)
                cell.vertical_alignment=1
                for para in cell.paragraphs:
                    para.paragraph_format.space_before=Pt(4); para.paragraph_format.space_after=Pt(4)
                    for run in para.runs:
                        run.font.size=Pt(10); run.font.color.rgb=RGBColor.from_string("FFFFFF" if row_index==0 else INK)
                        run.bold=row_index==0
            no_split=OxmlElement("w:cantSplit"); row._tr.get_or_add_trPr().append(no_split)
        doc.add_paragraph()
    def figure(name,caption,width=6.9):
        para=doc.add_paragraph(); para.alignment=1
        pic=para.add_run().add_picture(str(FIGURES/(name+".png")),width=Inches(width))
        pic._inline.docPr.set("descr",caption)
        doc.add_paragraph(caption,style="Caption")

    eyebrow=doc.add_paragraph()
    r=eyebrow.add_run("SE205.3   /   GROUP COURSEWORK 2026"); r.bold=True; r.font.size=Pt(10); r.font.color.rgb=RGBColor.from_string(CORAL)
    doc.add_paragraph("Surakuma",style="Title")
    brand=doc.add_paragraph(); brand.paragraph_format.space_after=Pt(12)
    r=brand.add_run("සුරැකුම"); r.font.name="Nirmala UI"; r.font.size=Pt(23); r.font.color.rgb=RGBColor.from_string(TEAL)
    doc.add_paragraph("Humanitarian crisis management and aid coordination",style="Subtitle")
    label=doc.add_paragraph("Software architecture technical report")
    label.runs[0].bold=True; label.runs[0].font.color.rgb=RGBColor.from_string(BLUE)
    art=doc.add_paragraph(); art.paragraph_format.space_after=Pt(13)
    art.add_run().add_picture(str(FIGURES/"report-cover.png"),width=Inches(7))
    meta=doc.add_paragraph("SUBMISSION  30 NOVEMBER 2026   /   PREPARED  22 OCTOBER 2026")
    meta.runs[0].font.size=Pt(9); meta.runs[0].bold=True; meta.runs[0].font.color.rgb=RGBColor.from_string(BLUE)
    for label in ["Institution","Programme","Lecturer","Student name and ID","Team members and IDs"]:
        para=doc.add_paragraph(); para.paragraph_format.space_after=Pt(9)
        run=para.add_run(label+"  "); run.bold=True; run.font.size=Pt(10)
        run=para.add_run("_"*max(15,64-len(label))); run.font.color.rgb=RGBColor.from_string("8A9CB3")
    note=doc.add_paragraph("Identity fields are intentionally blank for completion before submission.\nLocal prototype evidence recorded through 22 October 2026.")
    for r in note.runs: r.font.size=Pt(9); r.font.color.rgb=RGBColor.from_string("52667D")

    page("Report overview")
    p("Surakuma is an integrated local prototype for receiving assistance requests, coordinating human decisions, allocating aid, reserving shelter places and tracking volunteer work. The implementation uses React and TypeScript, an ASP.NET Core 10 API and SQL Server. Its principal architectural result is a single, auditable workflow with transactional stock and shelter protection, rather than separate screens with disconnected state.")
    p("The core build is operational in a synthetic Sri Lankan demonstration setting. The 21 October baseline records 30 backend and nine frontend tests passing. The expanded seven-test browser suite passed on 22 October 2026. These results support the exercised behaviours; they do not establish production readiness, native-speaker translation approval or live external-provider success.")
    p("External account activation is pending. AI uses a labelled deterministic fallback, email is captured locally, and authenticated route/search calls are unavailable without a key. The report distinguishes these modes from verified external integrations. Public map tiles still require internet access.")
    table(["Sections","Purpose"],[("Scope and requirements","Prototype boundary, actors and requirement coverage"),("Architecture and diagrams","Dependencies, classes, use cases, sequence and data relationships"),("Operational design","Rules, design patterns, security and resilience"),("Evidence and evaluation","Tests, screenshots, limitations and reproducible demonstration"),("Submission appendices","Setup, presentation handover and contribution fields")],[1.8,5.1])
    p("Figure sources are editable SVG files under docs/diagrams/rendered, with Mermaid and PlantUML sources retained under docs/diagrams. Code and setup paths in this report are relative to the submitted project root.")

    page("Scope and requirement coverage")
    p("The assessment brief [1] describes a broad humanitarian platform and specifies an end-to-end prototype minimum. The agreed solo-build boundary prioritises citizen, coordination, logistics, shelter, volunteer and administration workflows. Donation management and the additional analytics described in the broader brief are not implemented and should not be presented as delivered features.")
    table(["Requirement area","Current implementation and evidence"],[
        ("Citizen portal","Account, household, four-step request, private optional evidence, tracking, notifications and feedback."),
        ("Coordination and AI","Verify and approve separately; review original recommendation; override with reason; resolve duplicate flags; explicit sharing."),
        ("Resources and shelters","Reserve, dispatch and deliver quantities; retain remainder; reserve whole households; check in and depart separately."),
        ("Volunteers","Administrator membership, verified profile, skills/availability, assignment, acceptance and staff-verified completion."),
        ("Security and reliability","JWT, rotating refresh sessions, current membership checks, SQL transactions, row versions, outbox and deduplication."),
        ("Communication and mapping","Adapters and explicit failure states implemented. Live AI/email/routing success is pending accounts."),
        ("Broader brief gaps","No donations/campaign accounting, SMS, AI chat, forecasting, anomaly workflow, automated multilingual generation or geographic coverage analysis.")
    ],[1.65,5.25])
    p("The prototype supports multiple crisis and organisation records. Assigned coordinators have crisis oversight; other staff access their organisation's cases or explicitly shared cases. Administration is distinct from operational approval. Public registration cannot grant staff privileges.")
    p("A single assistance request has one aid category. Food and shelter for the same household are separate requests; the application does not silently reclassify a food case into a shelter placement. Sri Lankan data is synthetic and does not represent monitored emergency operations.")

    page("Use cases and authority")
    figure("use-cases","Figure 1 Selected implemented use cases and actors",6.45)
    p("Public information requires no account. Citizen submission requires an account. Staff actions additionally require role and record scope. Escalation is available to case reviewers; cross-organisation sharing is granted by an authorised coordinator. Volunteer completion remains subject to coordinator verification.")

    page("Architecture selection and boundaries")
    p("A modular monolith is appropriate for one developer and one local Windows deployment. Inventory, reservations, cases and outbox records can share a SQL transaction boundary. Microservices would add service discovery, distributed consistency and deployment work without resolving a demonstrated prototype bottleneck. The trade-off is shared deployment and scaling of modules.")
    table(["Project","Responsibility and dependency"],[
        ("Surakuma.Domain","Entities, enums and invariants; no ASP.NET or EF reference."),
        ("Surakuma.Application","Operations, AccessService, DTOs and ports; depends on Domain."),
        ("Surakuma.Infrastructure","EF/Identity, provider adapters, notification worker and seed data; implements application ports."),
        ("Surakuma.Api","HTTP routing, DTO validation, authentication, dependency registration, limits and error translation."),
        ("React frontend","Public/citizen and staff workspaces; server state through TanStack Query; access token in memory.")
    ],[2.0,4.9])
    p("Controllers delegate workflows to Operations. AccessService evaluates current memberships, crisis assignments, ownership and case shares. IStore exposes querying, saves and transactions; EfStore supplies SQL implementation. Dependency injection composes these components [2]. This enables provider substitution in tests without network calls.")
    p("Operations currently groups multiple application workflows in one class, and IStore exposes IQueryable. This is a pragmatic prototype compromise rather than strict aggregate isolation. Future module growth should split application services and introduce focused queries or specifications without changing domain invariants.")
    h("Scalability considerations")
    p("The current target is a single API instance and SQL-backed background worker. Request and audit pagination limit selected reads, but several directories and metrics load bounded or full in-scope collections. Production growth requires query profiling, wider pagination, durable file storage, backup/restore drills, monitoring and worker-scale testing. No throughput or availability guarantee has been measured.")

    page("Component architecture")
    figure("component","Figure 2 Runtime components and external boundaries",6.65)
    p("The worker consumes committed SQL outbox records asynchronously. External AI and email are optional adapter paths; absence remains visible. OSM browser tiles are separate from authenticated backend geocoding and routing. The frontend never receives provider credentials.")

    page("Domain class design")
    figure("classes","Figure 3 Selected domain classes and associations",6.2)
    p("AssistanceRequest protects lifecycle and delivery quantities. Resource and Shelter protect available stock and capacity. Recommendation and HumanDecision preserve machine proposals and staff responses separately. The model uses composition and replaceable interfaces rather than an inheritance hierarchy for each actor role.")

    page("Data model and transaction design")
    p("EF Core Code First migrations create relational records for identity, organisations, membership, crisis response, cases, recommendations, logistics, shelters, volunteers, communication and audit. SQL Server was selected to exercise actual row-version and transactional behaviour rather than substitute in-memory semantics.")
    table(["Constraint","Purpose"],[
        ("Unique citizen and submission key","Sequential retried submissions resolve to the existing request; database uniqueness also blocks duplicates."),
        ("Unique membership and case sharing keys","Prevent duplicate grants for the same user/role/organisation or case/organisation."),
        ("Resource check constraint","Stock >= 0; reserved >= 0; reserved <= physical stock."),
        ("Shelter check constraint","Capacity >= 1; reservation and occupancy nonnegative; their sum cannot exceed capacity."),
        ("Request quantity constraint","Delivered quantity remains between zero and requested quantity; household size is positive."),
        ("Notification unique keys","A recipient/event pair cannot create repeated notification or delivery records.")
    ],[2.35,4.55])
    p("Record versions map to SQL rowversion. Resource and shelter allocation execute inside serializable transactions. Concurrent attempts therefore cannot both consume the same available quantity or spaces; a conflict requires refreshing current state. Request changes, history, audit and outbox records are saved together. EF transaction behaviour is documented in [3].")
    p("Physical stock decreases at dispatch. Delivery increases the case's delivered quantity; it does not deduct physical stock a second time. Cancelling an un-dispatched reservation releases committed stock. Dispatched aid cannot be silently returned by a cancellation operation. Shelter check-in moves reserved spaces to occupancy; departure releases occupancy.")
    p("Foreign keys restrict deletion of related operational history. Audit actor/entity references and outbox/delivery event identifiers are not all enforced foreign keys; they are intentional application correlations. Retention, archival and operational backup policies need further design for a live deployment.")

    page("Identity and case relationships")
    figure("er-cases","Figure 4 Selected identity and case tables with key labels",6.5)
    p("The diagram abbreviates standard ASP.NET Identity role/claim/login tables. Each FK label refers to a parent entity; selected association lines are shown for readability. Full relationships and indexes are reproducible from Infrastructure/Data.cs, migrations and database/scripts/schema.sql.")

    page("Aid delivery relationships")
    figure("er-delivery","Figure 5 Selected logistics shelter and volunteer tables",6.5)
    p("StockMovement records refer to Resource. Both resource and shelter allocation records refer to AssistanceRequest. VolunteerTask refers to a verified VolunteerProfile and a case. Delivery event IDs are correlations rather than a claim that every event relation is a database FK. Quantities and states remain separately recorded.")

    page("Major workflow sequence")
    figure("sequence","Figure 6 Submission human review partial allocation and notification",6.2)
    p("The diagram summarises responsibility hand-offs; the API translates between the browser and application. Transactional reservation and outbox processing protect operational consistency. Rejected AI advice does not reject the request, and a successful external call never dispatches aid by itself.")

    page("Design patterns tied to code")
    table(["Pattern","Implementation","Reason and trade-off"],[
        ("Repository port","IStore and EfStore","Centralises saves/transactions. IQueryable leaks some query composition detail; not a strict aggregate repository."),
        ("Dependency injection","Program.cs registration and constructor ports","Replaces SQL/provider implementations in tests. Lifetimes and composition still require deliberate management."),
        ("Factory","EmailProviderFactory.Create","Selects Capture or Brevo and rejects unknown modes. Selection is explicit configuration, not automatic fallback sending."),
        ("Strategy","IAllocationPolicy and ConstraintAllocationPolicy","Checks category, stock, outstanding commitments and transport. Staff assess suitability and location; no optimal-route solver is claimed."),
        ("Adapter","AiProvider, EmailProvider and mapping provider","Translates external payloads into application contracts and controlled failure outcomes."),
        ("Durable event consumer","OutboxMessage and NotificationWorker","Asynchronous persisted event processing prevents uncommitted case events. No external broker, fan-out pub/sub bus or in-process Observer implementation is claimed.")
    ],[1.25,2.1,3.55])
    h("OOP examples")
    p("Resource.Reserve and Shelter.Reserve encapsulate invariant checks, while AssistanceRequest.Transition controls legal state movement. Interfaces provide abstraction and polymorphic provider substitution. Record is the common identity/timestamp/version base. These choices connect object behaviour to rules rather than using entities as uncontrolled data containers.")

    page("AI governance and external integrations")
    p("AI generation stores provider, model, category, urgency, explanation, fallback flag and review state. Confidence is nullable and explicitly unavailable when no calibrated estimate exists. Similarity is a separate token-overlap heuristic, not a probability that a request is fraudulent or invalid. Candidate requests remain available after duplicate review.")
    p("Authorised staff approve, modify, reject or defer advice. Modification/rejection requires a reason. The original recommendation remains preserved; HumanDecision records actor, action, reason, final priority and timestamps. A case is verified and approved separately. Category cannot be changed after allocation or delivery has begun without resolving existing commitments.")
    table(["Integration","Current behaviour","Live acceptance still needed"],[
        ("Gemini","Minimal description only for synthetic requests; deterministic labelled fallback on missing key, outage or invalid output.","Activate account/key; record real provider/model, response and human decision."),
        ("Brevo","Capture mode stores local notification evidence; retries/review states are persisted.","Verify sender and deliver one update to an authorised inbox."),
        ("openrouteservice","Backend proxy, timeouts and unavailable responses; manual location remains possible.","Public Sri Lankan geocode and driving route with real key."),
        ("OpenStreetMap","Browser requests attributed online map tiles.","Network availability and tile-policy compliance; no offline tile cache is supplied.")
    ],[1.25,3.05,2.6])
    p("Administration reports configuration state without returning keys. Configured does not mean live-tested. Provider pricing, eligibility, quota and data terms must be checked through official references [6-9]. No external account or real email was used for the recorded automated results.")

    page("Security and privacy")
    p("ASP.NET Identity manages local accounts, password hashing, roles and lockout [4]. This prototype adds its own short-lived JWT and rotating refresh-session workflow. JWT access tokens stay in browser memory. Refresh tokens are random, hashed in SQL and carried in a Secure HTTP-only cookie. Replay of a revoked refresh token revokes the remaining refresh sessions for that user. This is a local prototype authentication design, not a claim of a complete OAuth/OIDC identity provider.")
    p("Role checks are combined with ownership, current organisation memberships, assigned crises and explicit case shares. Citizens see their own records; volunteers update their own tasks. Administrators grant memberships but do not automatically gain case approval authority. This follows the principle of checking permission at the server boundary rather than trusting hidden UI controls [5].")
    p("Evidence is optional. Only authorised downloads can access private JPEG/PNG files stored with random names; size and count limits apply. File signatures are checked. The prototype does not include malware scanning, a quarantine pipeline or a full image decode/re-encode service. External free AI receives no account identity, exact coordinates or attachments, and real personal requests cannot use that adapter.")
    p("Validation, consistent Problem Details, HTTPS, origin configuration and request limits reduce common failure paths. They do not replace a penetration test, threat-model review or production operational controls. In particular, no self-service forgotten-password or email-verification journey is delivered. Same-device demonstration credentials are generated locally and excluded from the submission archive.")
    h("Risk treatment")
    table(["Risk","Current treatment and remaining work"],[("Cross-user disclosure","Ownership and organisation tests; extend review to every new endpoint."),("Oversold stock or shelter","SQL constraints, serializable transactions and concurrency tests."),("Uncertain email send","Review state; investigate provider outcome before retrying."),("Misleading AI advice","Labels, nullable confidence, preserved human action and no automatic approval."),("Unreviewed translated guidance","Language keys exist; native-speaker approval remains pending.")],[2,4.9])

    page("Reliability and API design")
    p("The API uses /api/v1 resources and typed DTOs. Case lists return items, total, pageNumber and pageSize. HTTP 400 denotes invalid input or a business-rule violation; 401 unauthenticated access; 403 denied authority; 404 absent/invisible case; 409 a concurrency/uniqueness conflict; 429 throttling; and 503 unavailable readiness or mapping. Swagger and the exported 50-path specification describe the delivered routes.")
    p("Case changes and outbox events commit atomically. The worker claims pending events, creates deduplicated in-app notifications and records email delivery attempts. Provider throttling uses bounded retry. A send with unknown outcome enters Review rather than being automatically repeated. A stale Processing record is also reviewed, because the worker cannot assume the remote send did not happen.")
    p("AI outage and malformed output use a labelled deterministic rule result. Missing routes remain explicitly unavailable; a displayed driving route is not a verified evacuation route. Core data submission and staff review do not depend on successful external recommendations. Startup liveness is separate from database readiness.")
    p("Operational mutations keep buttons pending until refreshed queries settle. Logout clears local session data and replaces the browser document after server-side logout, discarding previous account router state. The interface distinguishes throttling from incorrect credentials. These changes were driven by the operational browser journey.")
    h("Residual reliability work")
    p("Production recovery requires measured monitoring, backup restoration, deployment rollback, retention policies and scaling tests. The prototype has a single SQL-backed asynchronous worker rather than a distributed messaging cluster. No delivery-time guarantee, offline operation or external service availability guarantee is claimed.")

    page("Verification and traceability")
    p("The backend/frontend baseline on 21 October 2026 used Windows, .NET SDK 10.0.401, Node 24.16.0 and SQL Server Express. The expanded browser suite passed on 22 October. API tests use an isolated Surakuma_Test_<guid> database, apply migrations and remove only that fixture database. Browser checks use synthetic demonstration records. These are executed results, not a native-speaker or participant UAT sign-off.")
    table(["Suite","Executed result","Selected evidence"],[("Backend","30 passed on 21 Oct","Permissions, refresh replay, AI failures/override, stock/shelter races, notifications and complete household workflow."),("Frontend","9 passed on 21 Oct","Role-aware routing, forms/draft, translation keys, status/retry and login 429 explanation."),("Browser","7 passed together on 22 Oct","Citizen review/delivery/closure, account switching, admin status, responsive pages, keyboard/text enlargement and actual Swagger GET execution."),("Build and schema","Passed on 21 Oct","API build, SQL migrations, production frontend build and readiness."),("Accessibility scans","No violations on scanned pages","Axe public desktop and mobile citizen form checks; not whole-application WCAG certification.")],[1.2,1.65,4.05])
    p("DomainTests cover invariant behaviour. ProviderTests use controlled responses rather than live services. IntegrationTests cover registration privilege injection, cross-user denial, explicit sharing, duplicate processing and contested quantities. DemonstrationIntegrationTests covers food and a separate accessible-shelter request for the same household, including volunteer staff verification and captured notifications.")
    p("The browser suite switches several synthetic roles quickly. Its explicit -BrowserTests startup option raises the authentication allowance for that test process only; normal startup retains the default. The final source package excludes live credentials, evidence storage, build products, test traces and dependencies.")

    page("Interface evidence")
    figure("../..//screenshots/admin-integrations","Figure 7 Administrator configuration modes and read-only integration readiness",6.9)
    p("The interface uses navy text, coral actions, rounded white cards and pastel category accents. Public/citizen journeys contain English, Sinhala and Tamil keys. The readiness panel explicitly separates fallback/capture from external success; its refresh action neither contacts providers nor sends email.")
    p("Additional reproducible screenshots under docs/screenshots show the 375px, tablet and desktop homepage, Tamil layout, case review, citizen form and partial delivery. The files are synthetic demonstration evidence. Review them alongside the video and executed tests rather than treating a screenshot alone as proof of a server-side rule.")

    page("Evaluation and limitations")
    p("The strongest evidence is the coherent operational path and the rules tested under real SQL Server concurrency. A request's partial quantity remains open; stock and occupancy have distinct accounting; AI advice and human approval remain distinct. Provider failures preserve manual operation. These behaviours address the assessment's emphasis on consistency, governance and accountability [1].")
    p("The accepted local prototype boundary leaves several brief areas incomplete: donation/campaign and expenditure records, SMS, AI chat, forecasting/anomaly workflows, automated multilingual generation, richer partner assistance requests, recurring volunteer scheduling, location-aware volunteer ranking and geographic coverage reporting. Payments are optional in the brief and not implemented. Explicit case sharing does not constitute a full partner support-request workspace.")
    p("Live Gemini/Brevo/routing calls remain unverified until account setup. Translation keys are complete but wording needs native-speaker review, including staff-entered public text. Automated axe checks cover selected pages only. Elderly-user, keyboard/screen-reader and text-enlargement UAT must be performed and recorded; blank review forms are supplied without fabricated results.")
    p("The build was implemented sequentially by one developer. Team members may prepare demonstrations and perform real testing/documentation later. Presentation ownership must not be recorded as implementation authorship. Existing source files are not yet backed by a complete historical sequence of Git commits; current files and test records cannot retroactively manufacture that history.")
    h("Completion gates before submission")
    p("Fill cover and contribution fields; review the report against the lecturer's instructions; complete live provider checks; obtain language/UAT reviews; inspect the recorded demonstration and its viewing method; then rebuild the submission ZIP. Do not tick a human approval or live-service result solely because the corresponding code exists.")

    page("Setup and demonstration procedure")
    p("Prerequisites are Windows, .NET 10 SDK, Node 24+, SQL Server Express/Developer and Windows-authenticated database creation permission. The default SQL instance is .\\SQLEXPRESS. The source README describes overrides and development certificate handling.")
    for text in ["1. Run scripts/Setup.ps1 to restore dependencies, migrate SQL and generate development-only credentials.","2. Start scripts/Start-Api.ps1 and scripts/Start-Web.ps1 in separate terminals. Open http://localhost:5173 and confirm /api/v1/ready.","3. Read only Seed.Password from the ignored backend/data/development-settings.json file. The account list is in README. The submission does not include the current generated password.","4. Run scripts/Test.ps1. For browser acceptance, start the API with -BrowserTests and use npm run test:e2e from frontend. Restart the API normally afterward.","5. Demonstrate a citizen flood request, staff AI review/override, limited stock, partial dispatch/delivery, replenishment, separate accessible shelter, volunteer work, notifications, closure and audit.","6. Use docs/integrations.md for later external setup. Record provider/model/event evidence without exposing credentials. Captured email is not sent email."]:
        p(text)
    p("A locally recorded browser walkthrough and timed transcript are supplied separately. It uses synthetic data and captions; it is not a narrated lecturer presentation. If the lecturer requires a hosted link, upload the reviewed recording yourself and verify lecturer permissions before submission. No hosting link is fabricated.")

    page("Individual contributions and reflection")
    p("Complete the following fields using the work actually undertaken. The agreed implementation approach is a solo build followed by allocation of presentation responsibilities. Names, contribution records and reflections are deliberately blank for the students to complete.")
    table(["Student name and ID","Actual work and evidence","Presentation responsibility"],[("________________","________________\n________________","________________") for _ in range(5)],[1.9,3.1,1.9])
    for title in ["Responsibilities and features implemented","Testing and documentation performed","Git commits issues or equivalent evidence","Challenges and architectural decisions influenced","Lessons learned and next improvements"]:
        h(title); p("______________________________________________________________________\n______________________________________________________________________")

    page("References and source evidence")
    references=[
        "[1] SE205.3 Humanitarian Crisis Coursework 2026. Institution-supplied assessment brief, 11 pages. Sections 5 to 10 define deliverables, criteria, advanced requirements and submission expectations.",
        "[2] Microsoft. .NET dependency injection. https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview (accessed 22 October 2026).",
        "[3] Microsoft. Using transactions in EF Core. https://learn.microsoft.com/en-us/ef/core/saving/transactions (accessed 22 October 2026).",
        "[4] Microsoft. Introduction to Identity on ASP.NET Core. https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity?view=aspnetcore-10.0 (accessed 22 October 2026).",
        "[5] OWASP. Authorization Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html (accessed 22 October 2026).",
        "[6] Google. Gemini API models, pricing and terms. https://ai.google.dev/gemini-api/docs/models ; https://ai.google.dev/gemini-api/docs/pricing ; https://ai.google.dev/gemini-api/terms . Setup references; account access and current terms still require review before use.",
        "[7] Brevo. Pricing plans. https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans . Setup reference; sender activation is pending.",
        "[8] GIScience. openrouteservice FAQ. https://giscience.github.io/openrouteservice/frequently-asked-questions . Setup reference; live geocoding/routing is pending.",
        "[9] OpenStreetMap Foundation. Tile usage policy. https://operations.osmfoundation.org/policies/tiles/ . Map-tile usage reference.",
        "[10] Project evidence: docs/testing/results.md; backend/tests/Surakuma.Tests; frontend/src/test; frontend/e2e; docs/screenshots; docs/api/openapi.json; database/scripts/schema.sql. Baseline results date 21 October 2026; expanded browser and recording evidence 22 October 2026."
    ]
    for reference in references: p(reference)
    # Clear template border residue while preserving the requested branded palette.
    for style in doc.styles:
        for border in list(style.element.iter(qn("w:pBdr"))):
            border.getparent().remove(border)
    for part in [doc.element,sec.header._element,sec.footer._element]:
        for border in list(part.iter(qn("w:pBdr"))): border.getparent().remove(border)
    output=ROOT/"output/docx/Surakuma-technical-report.docx"; output.parent.mkdir(parents=True,exist_ok=True)
    doc.save(output)
    print(f"Created {output}")


if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--document",action="store_true"); args=parser.parse_args()
    report() if args.document else diagrams()
