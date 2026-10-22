import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
} from "docx";

const PRIMARY_COLOR = "1E3A8A"; // Deep Navy Blue
const SECONDARY_COLOR = "2563EB"; // Royal Blue
const ACCENT_COLOR = "7C3AED"; // Purple Accent
const BG_HEADER = "F1F5F9"; // Light Slate Header
const BG_ALT_ROW = "F8FAFC"; // Very Light Slate
const TEXT_MUTED = "64748B";

function createCell(text, isHeader = false, widthPercent = 25, isAlt = false) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: {
      type: ShadingType.CLEAR,
      fill: isHeader ? BG_HEADER : isAlt ? BG_ALT_ROW : "FFFFFF",
    },
    margins: { top: 120, bottom: 120, left: 150, right: 150 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: isHeader,
            color: isHeader ? PRIMARY_COLOR : "1E293B",
            size: isHeader ? 20 : 18, // 10pt / 9pt
            font: "Segoe UI",
          }),
        ],
      }),
    ],
  });
}

function createHeading1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 120 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 32, // 16pt
        color: PRIMARY_COLOR,
        font: "Segoe UI",
      }),
    ],
  });
}

function createHeading2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 26, // 13pt
        color: SECONDARY_COLOR,
        font: "Segoe UI",
      }),
    ],
  });
}

function createParagraph(text, isMuted = false) {
  return new Paragraph({
    spacing: { before: 60, after: 100 },
    children: [
      new TextRun({
        text,
        size: 20, // 10pt
        color: isMuted ? TEXT_MUTED : "334155",
        font: "Segoe UI",
      }),
    ],
  });
}

function createBullet(title, desc) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 60 },
    children: [
      new TextRun({
        text: title + ": ",
        bold: true,
        size: 20,
        color: "1E293B",
        font: "Segoe UI",
      }),
      new TextRun({
        text: desc,
        size: 20,
        color: "475569",
        font: "Segoe UI",
      }),
    ],
  });
}

async function generateDocx() {
  console.log("Generating Storyline 360 Complete 7-Phase Word Document (.docx)...");

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "WorkTracker Enterprise Project Plan | Storyline 360 Course (7 Phases)",
                    size: 16,
                    color: TEXT_MUTED,
                    font: "Segoe UI",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.SPACE_BETWEEN,
                children: [
                  new TextRun({
                    text: "Confidential — For Internal Project & Client Review Only",
                    size: 16,
                    color: TEXT_MUTED,
                    font: "Segoe UI",
                  }),
                  new TextRun({
                    children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: TEXT_MUTED,
                    font: "Segoe UI",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 400, after: 100 },
            children: [
              new TextRun({
                text: "STORYLINE 360 COURSE PROJECT PLAN",
                bold: true,
                size: 44, // 22pt
                color: PRIMARY_COLOR,
                font: "Segoe UI",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 200 },
            children: [
              new TextRun({
                text: "Complete 7-Phase Standard Operating Procedure & Multi-Module Delivery Specification",
                bold: true,
                size: 24, // 12pt
                color: SECONDARY_COLOR,
                font: "Segoe UI",
              }),
            ],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 400 },
            children: [
              new TextRun({
                text: "Standard Template ID: storyline-360 | Project Planning & Delivery Framework",
                size: 18,
                color: TEXT_MUTED,
                font: "Segoe UI",
              }),
            ],
          }),

          // Metadata Table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Document Metadata", true, 30),
                  createCell("Specification Details", true, 70),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Project Name", false, 30, true),
                  createCell("Interactive Storyline 360 Enterprise eLearning Curriculum", false, 70, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Authoring Tool", false, 30),
                  createCell("Articulate Storyline 360 (v3.85+) with HTML5 / Responsive Output", false, 70),
                ],
              }),
              new TableRow({
                children: [
                  createCell("LMS Target Compliance", false, 30, true),
                  createCell("SCORM 1.2, SCORM 2004 (4th Edition), AICC, and xAPI / Tin Can", false, 70, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Curriculum Structure", false, 30),
                  createCell("Global Shell + 4 Core Modular Units (Intro, Procedures, Advanced, Assessment)", false, 70),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Standard Daily Shift", false, 30, true),
                  createCell("7 Working Hours / Working Day (Configurable via WorkTracker Engine)", false, 70, true),
                ],
              }),
            ],
          }),

          // Section 1: Executive Summary
          createHeading1("1. Executive Summary & Confirmation Objective"),
          createParagraph(
            "This document defines the complete end-to-end task breakdown across all 7 phases of course production in Articulate Storyline 360. It incorporates the updated workflow structure: (1) Phase 1 reduced strictly to exactly two kickoff tasks (Project Kickoff & Alignment, Requirement Analysis & Content Ingestion), (2) Phase 2 includes dedicated Script Development preceding screen-by-screen Storyboard authoring, (3) Phase 3 introduces a mandatory Client Asset Approval Gate, and (4) Phase 4 features a Conditional HLD Prototype option (HLD Concept Slide & Client Sign-off). Utilizing WorkTracker's validated 7-Phase Execution Framework, the project coordinates Instructional Designers, Graphic Designers, 2D Animators, Storyline Course Developers, QA Specialists, and Client Stakeholders to deliver an engaging, SCORM/WCAG-compliant learning experience."
          ),

          // Section 2: Complexity Configurations
          createHeading1("2. Course Complexity & Productivity Rates"),
          createParagraph(
            "Production duration and effort scaling are determined by the Storyline 360 complexity tier selected for the curriculum:"
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Tier Level", true, 18),
                  createCell("Description & Animation Ratio", true, 42),
                  createCell("Dev / Animator Mix", true, 22),
                  createCell("Effort Factor", true, 18),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Level 1", false, 18, true),
                  createCell("Standard layout, basic click-to-reveal, linear knowledge checks. 0% custom motion animation.", false, 42, true),
                  createCell("100% Dev / 0% Anim", false, 22, true),
                  createCell("0.80x Multiplier", false, 18, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Level 2 (Standard)", false, 18),
                  createCell("Interactive branching, dynamic tabs/layers, ~10 mins custom 2D motion animation per 60 mins content.", false, 42),
                  createCell("83% Dev / 17% Anim", false, 22),
                  createCell("1.00x Multiplier", false, 18),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Level 2.5 (Enhanced)", false, 18, true),
                  createCell("Enhanced interactive branching with custom scenarios, ~20 mins custom 2D motion animation per 60 mins content.", false, 42, true),
                  createCell("67% Dev / 33% Anim", false, 22, true),
                  createCell("1.15x Multiplier", false, 18, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Level 3 (Rich)", false, 18),
                  createCell("Rich multimedia, bespoke character rigs, 50% custom 2D animation, scenario branching with custom variables.", false, 42, true),
                  createCell("50% Dev / 50% Anim", false, 22, true),
                  createCell("1.30x Multiplier", false, 18, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Level 4 (Heavy)", false, 18),
                  createCell("Animation-led experiential learning, ~50 mins 2D animation per 60 mins content, gamified logic & custom JS triggers.", false, 42),
                  createCell("17% Dev / 83% Anim", false, 22),
                  createCell("1.60x Multiplier", false, 18),
                ],
              }),
            ],
          }),

          // Section 3: Multi-Module Architecture
          createHeading1("3. Modular Course Architecture"),
          createParagraph(
            "The curriculum is partitioned into discrete, reusable modular learning units managed concurrently through Phases 2 to 6:"
          ),
          createBullet("Module 0 — Global Course Shell", "Custom branded master slides, global menu navigation drawer, resources repository, audio toggle, accessibility high-contrast theme, and custom exit triggers."),
          createBullet("Module 1 — Foundational Overview & Core Concepts", "Course objectives, scenario premise, foundational principles, interactive infographics, and introductory knowledge check (est. 15 minutes seat time)."),
          createBullet("Module 2 — Standard Operating Procedures & Branching Scenarios", "Step-by-step interactive software simulations, decision-tree branching scenarios with real-time feedback, and roleplay challenges (est. 25 minutes seat time)."),
          createBullet("Module 3 — Advanced Troubleshooting & Risk Mitigation", "Complex problem solving, multi-state interactive diagnostics, scenario-based remediation, and policy adherence guidelines (est. 20 minutes seat time)."),
          createBullet("Module 4 — Knowledge Evaluation & Certification Exam", "Randomized question bank (20 items drawn from 40-question pool), scenario MCQs, drag-and-drop sequencing, 80% passing score threshold, and automated certificate generation (est. 15 minutes seat time)."),

          // Section 4: The 7 Phases Breakdown
          createHeading1("4. Complete Phase-by-Phase Task Data & Execution Breakdown"),

          // Phase 1
          createHeading2("Phase 1 — Project Initiation & Requirements Audit [Project-Wide Milestone — Strictly 2 Tasks]"),
          createParagraph("Scope: Initiation establishes project governance, communication cadences, and content audit. High-Level Design (HLD) is excluded from Phase 1 to allow direct, unblocked kickoff."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("1.1 Project Kickoff & Alignment (task-kickoff)", false, 35, true),
                  createCell("Project Manager/ID", false, 20, true),
                  createCell("SOW / Project Charter", false, 20, true),
                  createCell("Project Schedule, Roles RACI, Communication Plan", false, 15, true),
                  createCell("1 Day (7.0h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("1.2 Requirement Analysis & Content Ingestion (task-req-analysis)", false, 35),
                  createCell("Instructional Designer", false, 20),
                  createCell("1.1 Project Kickoff", false, 20),
                  createCell("Audience Profile, Source Gap Analysis, Content Outline", false, 15),
                  createCell("2 Days (14.0h)", false, 10),
                ],
              }),
            ],
          }),

          // Phase 2
          createHeading2("Phase 2 — Script Development & Instructional Storyboard [Module-Level Execution across Modules 1–4]"),
          createParagraph("Scope: Transforms raw curriculum into a full narrative script, followed by screen-by-screen Storyboard authoring, peer review, and formal client approval freeze."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2.1 Script Development & Content Outlining (task-script-dev)", false, 35, true),
                  createCell("Instructional Designer", false, 20, true),
                  createCell("1.2 Requirement Analysis", false, 20, true),
                  createCell("Modular Script Narrative, Question Formats, Case Outlines", false, 15, true),
                  createCell("1 Day / Mod (3.5–7h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2.2 Storyboard Development: Screen-by-Screen (task-storyboard-dev)", false, 35),
                  createCell("Instructional Designer", false, 20),
                  createCell("2.1 Script Development", false, 20),
                  createCell("Complete Storyboard: Visual Prompts, Audio Script, Logic", false, 15),
                  createCell("Dynamic (0.4h/min)", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2.3 Internal Storyboard Review & Polish (task-internal-sb)", false, 35, true),
                  createCell("ID Peer Reviewer", false, 20, true),
                  createCell("2.2 Storyboard Dev", false, 20, true),
                  createCell("Peer Quality Scorecard, Pedagogical Polish", false, 15, true),
                  createCell("0.5 Day (3.5h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("★ 2.4 Client Storyboard Review Cycle (task-client-sb)", false, 35),
                  createCell("Client Stakeholder", false, 20),
                  createCell("2.3 Internal Review", false, 20),
                  createCell("Client Review 360 Feedback Comments", false, 15),
                  createCell("2–3 Client Days", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2.5 Storyboard Revisions & Freeze Sign-off (task-sb-revisions)", false, 35, true),
                  createCell("Instructional Designer", false, 20, true),
                  createCell("2.4 Client Review", false, 20, true),
                  createCell("Signed-off Locked Storyboard Document", false, 15, true),
                  createCell("1 Day (7.0h)", false, 10, true),
                ],
              }),
            ],
          }),

          // Phase 3
          createHeading2("Phase 3 — Visual Design & Asset Creation [Module-Level Execution + Mandatory Client Asset Approval Gate]"),
          createParagraph("Scope: Crafts all customized vector elements, character poses, infographics, and theme palettes with an explicit Client Asset Gate before development begins."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3.1 Custom UI Graphics & Character Development (task-ui-assets)", false, 35, true),
                  createCell("Visual Designer", false, 20, true),
                  createCell("2.5 Storyboard Sign-off", false, 20, true),
                  createCell("Vector Character Library, Custom Theme Skins, UI Badges", false, 15, true),
                  createCell("2 Days / Mod (14h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("★ 3.2 Client Approval on Visual Assets & Media (task-client-asset-approval)", false, 35),
                  createCell("Client Stakeholder", false, 20),
                  createCell("3.1 Custom UI Graphics", false, 20),
                  createCell("Written / Review 360 Asset Sign-off", false, 15),
                  createCell("1–2 Client Days", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3.3 Voiceover Studio Recording in case HVO or AI VO & Clean Delivery (task-audio-vo)", false, 35, true),
                  createCell("Voiceover Artist / Audio", false, 20, true),
                  createCell("2.5 Storyboard Sign-off", false, 20, true),
                  createCell("High-Fidelity Master MP3/WAV Audio Files", false, 15, true),
                  createCell("2 Calendar Days", false, 10, true),
                ],
              }),
            ],
          }),

          // Phase 4
          createHeading2("Phase 4 — Development, Animation & Conditional HLD Gate [Module-Level Execution — Configurable HLD Toggle]"),
          createParagraph("Scope: If 'HLD / CS HLD' is enabled in plan settings, tasks 4.1 & 4.2 execute as a prerequisite prototype. If disabled, production immediately builds 2D animations and Storyline slide interactions based on Phase 3 Client Asset Approval."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("[CONDITIONAL] 4.1 High-Level Design (HLD) Concept Slide (task-hld-concept)", false, 35, true),
                  createCell("Lead Developer / Designer", false, 20, true),
                  createCell("3.2 Client Asset Approval", false, 20, true),
                  createCell("Sample Interactive Slide demonstrating triggers & visual feel", false, 15, true),
                  createCell("1 Day (7.0h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("★ [CONDITIONAL] 4.2 Client HLD Sign-off / CS HLD (task-client-hld)", false, 35),
                  createCell("Client Stakeholder", false, 20),
                  createCell("4.1 HLD Concept Slide", false, 20),
                  createCell("Approval on Navigation Shell & Interaction Mechanics", false, 15),
                  createCell("1–2 Client Days", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4.3 Animation & Visual FX (task-2d-anim)", false, 35, true),
                  createCell("2D Animator", false, 20, true),
                  createCell("3.2 Asset Approval (or 4.2 if HLD selected)", false, 20, true),
                  createCell("Rendered MP4 / Motion Graphics Animations", false, 15, true),
                  createCell("Dynamic (3.5h/min)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4.4 Storyline Interactive Slide Programming (task-storyline-dev)", false, 35),
                  createCell("Course Developer", false, 20),
                  createCell("3.2 Asset Approval (or 4.2 if HLD selected)", false, 20),
                  createCell("Storyline Slides, Variables, Audio Sync, Scoring Triggers", false, 15),
                  createCell("Dynamic (2.33h/min)", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4.5 Internal Media Integration & Alpha Build (task-integration)", false, 35, true),
                  createCell("Course Developer", false, 20, true),
                  createCell("4.3 Animation & 4.4 Slide Dev", false, 20, true),
                  createCell("Compiled Alpha Course Package ready for Internal QA", false, 15, true),
                  createCell("1 Day (7.0h)", false, 10, true),
                ],
              }),
            ],
          }),

          // Phase 5
          createHeading2("Phase 5 — Quality Assurance & Multi-Device Testing [Module-Level Execution]"),
          createParagraph("Rigorous multi-point testing covering functionality, LMS tracking, SCORM bookmarks, and WCAG accessibility."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5.1 Functional, SCORM & a11y QA (task-func-qa)", false, 35, true),
                  createCell("QA Specialist", false, 20, true),
                  createCell("4.5 Alpha Build", false, 20, true),
                  createCell("Exhaustive Defect Log, SCORM Tracking & a11y Audit", false, 15, true),
                  createCell("Dynamic (0.92h/min)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5.2 Developer Bug Fixes & Refinements (task-qa-fixes)", false, 35),
                  createCell("Course Developer", false, 20),
                  createCell("5.1 Functional QA", false, 20),
                  createCell("Resolved Bug Sheet & Corrected Slide Builds", false, 15),
                  createCell("1 Day (7.0h)", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5.3 Beta Build QA Sign-off (task-qa-signoff)", false, 35, true),
                  createCell("QA Specialist", false, 20, true),
                  createCell("5.2 Bug Fixes", false, 20, true),
                  createCell("Internal Quality Gate Certificate & Beta Release Candidate", false, 15, true),
                  createCell("0.5 Day (3.5h)", false, 10, true),
                ],
              }),
            ],
          }),

          // Phase 6
          createHeading2("Phase 6 — Client Review & Feedback Implementation [Module-Level Execution]"),
          createParagraph("Stakeholder verification, feedback logging, and gold master freeze."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("★ 6.1 Client Beta Review on Review 360 / Staging LMS (task-client-beta)", false, 35, true),
                  createCell("Client Stakeholder", false, 20, true),
                  createCell("5.3 Beta QA Sign-off", false, 20, true),
                  createCell("Consolidated Client Beta Review Matrix", false, 15, true),
                  createCell("2–3 Client Days", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("6.2 Client Feedback Implementation & Polish (task-feedback-fixes)", false, 35),
                  createCell("Course Developer / ID", false, 20),
                  createCell("6.1 Client Beta Review", false, 20),
                  createCell("Implemented Changes with Changelog Tracking", false, 15),
                  createCell("1 Day (7.0h)", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("★ 6.3 Client Gold Master Sign-off (task-gold-approval)", false, 35, true),
                  createCell("Client Stakeholder", false, 20, true),
                  createCell("6.2 Feedback Fixes", false, 20, true),
                  createCell("Formal Client Acceptance & Authoring Freeze", false, 15, true),
                  createCell("1 Client Day", false, 10, true),
                ],
              }),
            ],
          }),

          // Phase 7
          createHeading2("Phase 7 — LMS Delivery, Staging & Project Closure [Project-Wide Milestone]"),
          createParagraph("Final SCORM packaging, staging verification, source handover, and formal retrospective."),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Task Identifier & Description", true, 35),
                  createCell("Assigned Role", true, 20),
                  createCell("Prerequisite / Dependency", true, 20),
                  createCell("Key Deliverable / Output", true, 15),
                  createCell("Est. Time / Days", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("7.1 LMS SCORM 1.2 / 2004 / xAPI Final Package Export (task-scorm-packaging)", false, 35, true),
                  createCell("Course Developer", false, 20, true),
                  createCell("6.3 Gold Master Sign-off", false, 20, true),
                  createCell("Tested Production LMS ZIP Packages", false, 15, true),
                  createCell("1 Day (7.0h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("7.2 LMS Staging Validation & Sanity Verification (task-lms-validation)", false, 35),
                  createCell("QA Specialist", false, 20),
                  createCell("7.1 SCORM Packaging", false, 20),
                  createCell("Resumption Test Report, Completion & Score Audit", false, 15),
                  createCell("1 Day (7.0h)", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("7.3 Final Source Files (.story) & Asset Handover (task-final-handover)", false, 35, true),
                  createCell("Project Manager", false, 20, true),
                  createCell("7.2 LMS Validation", false, 20, true),
                  createCell("Master .story Files, Vector Assets, Audio Tracks on Cloud", false, 15, true),
                  createCell("0.5 Day (3.5h)", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("7.4 Formal Project Retrospective & Contract Closure (task-project-closure)", false, 35),
                  createCell("Project Manager", false, 20),
                  createCell("7.3 Source Handover", false, 20),
                  createCell("Project Post-Mortem Report & Final Contract Sign-off", false, 15),
                  createCell("0.5 Day (3.5h)", false, 10),
                ],
              }),
            ],
          }),

          // Section 5: RACI Matrix
          createHeading1("5. Roles & Responsibilities Matrix (RACI)"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Phase / Deliverable", true, 30),
                  createCell("PM", true, 10),
                  createCell("ID", true, 10),
                  createCell("VD", true, 10),
                  createCell("ANIM", true, 10),
                  createCell("DEV", true, 10),
                  createCell("QA", true, 10),
                  createCell("CLIENT", true, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 1: Initiation & Requirements (2 Tasks)", false, 30, true),
                  createCell("A / R", false, 10, true),
                  createCell("R", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("C", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 2: Script Dev & Storyboards", false, 30),
                  createCell("A", false, 10),
                  createCell("R", false, 10),
                  createCell("C", false, 10),
                  createCell("I", false, 10),
                  createCell("C", false, 10),
                  createCell("C", false, 10),
                  createCell("C / A", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 3: Visual Assets & Client Asset Gate", false, 30, true),
                  createCell("A", false, 10, true),
                  createCell("C", false, 10, true),
                  createCell("R", false, 10, true),
                  createCell("C", false, 10, true),
                  createCell("C", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("C / A", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 4: Conditional HLD, Animation & Dev", false, 30),
                  createCell("A", false, 10),
                  createCell("C", false, 10),
                  createCell("C", false, 10),
                  createCell("R", false, 10),
                  createCell("R", false, 10),
                  createCell("I", false, 10),
                  createCell("C / A", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 5: Quality Assurance (QA)", false, 30, true),
                  createCell("A", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("C", false, 10, true),
                  createCell("C", false, 10, true),
                  createCell("R", false, 10, true),
                  createCell("I", false, 10, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 6: Client Beta Review & Gold Master", false, 30),
                  createCell("A", false, 10),
                  createCell("C", false, 10),
                  createCell("I", false, 10),
                  createCell("C", false, 10),
                  createCell("C", false, 10),
                  createCell("C", false, 10),
                  createCell("R / A", false, 10),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Phase 7: LMS Delivery & Closure", false, 30, true),
                  createCell("A / R", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("I", false, 10, true),
                  createCell("R", false, 10, true),
                  createCell("R", false, 10, true),
                  createCell("C / A", false, 10, true),
                ],
              }),
            ],
          }),
          createParagraph(
            "Legend: R = Responsible (executes the task), A = Accountable (final sign-off), C = Consulted (two-way collaboration), I = Informed (receives status updates).",
            true
          ),

          // Section 6: Quality Gates & Sign-offs
          createHeading1("6. Quality Gates & Client Acceptance Criteria"),
          createBullet("Gate 1: Client Visual Asset & Media Approval (Phase 3)", "Mandatory formal client sign-off on character styling, UI skins, and theme palettes before slide development begins."),
          createBullet("Gate 2: Conditional HLD / CS HLD Prototype Gate (Phase 4)", "Optional interactive prototype slide sign-off confirming navigation mechanics and trigger feel when HLD toggle is activated."),
          createBullet("Gate 3: Storyboard Freeze Gate (Phase 2)", "100% sign-off on script narratives, on-screen text, audio scripts, and pedagogical branching prior to asset creation."),
          createBullet("Gate 4: Internal Alpha QA Gate (Phase 5)", "Zero high/critical severity defects, passes SCORM Cloud API initialization, and triggers function properly."),
          createBullet("Gate 5: Client Beta Acceptance Gate (Phase 6)", "Client stakeholder validates content delivery on Review 360 / Staging LMS with consolidated feedback tracking."),
          createBullet("Gate 6: Final Gold Master Acceptance (Phase 6/7)", "Formal client acceptance of final build, freeze of authoring, and authorization for LMS package deployment."),

          // Sign-off section
          createHeading1("7. Formal Project Sign-off"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  createCell("Stakeholder Role", true, 30),
                  createCell("Signatory Name", true, 30),
                  createCell("Signature / Verification", true, 25),
                  createCell("Date", true, 15),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Lead Project Manager", false, 30, true),
                  createCell("Harshvardhan (PM)", false, 30, true),
                  createCell("Verified / Approved", false, 25, true),
                  createCell("2026-10-19", false, 15, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Lead Instructional Designer", false, 30),
                  createCell("Instructional Design Lead", false, 30),
                  createCell("Verified / Approved", false, 25),
                  createCell("2026-10-19", false, 15),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Course Development Lead", false, 30, true),
                  createCell("Senior Storyline 360 Developer", false, 30, true),
                  createCell("Verified / Approved", false, 25, true),
                  createCell("2026-10-19", false, 15, true),
                ],
              }),
              new TableRow({
                children: [
                  createCell("Client Project Sponsor", false, 30),
                  createCell("Client Executive Sponsor", false, 30),
                  createCell("Pending Final Gold", false, 25),
                  createCell("TBD", false, 15),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outputPath = path.resolve("d:/Harsh/Current_Running_Project/workTracker/Storyline_360_Course_Complete_7_Phase_Project_Plan.docx");
  fs.writeFileSync(outputPath, buffer);
  console.log("✅ Successfully written Word document (.docx) to:", outputPath);
}

generateDocx().catch((err) => {
  console.error("Failed to generate docx:", err);
  process.exit(1);
});
