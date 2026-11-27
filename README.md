# Anonymous Faculty Feedback System

A college feedback platform where students rate their faculty anonymously and administrators analyse the results by department, class, section, subject, semester and academic year.

- **Student portal** (`/`): sign in with a register number and date of birth, see only your own class's faculty-subject pairs, rate ten questions from 1 to 10 (half points allowed), add an optional comment, and submit anonymously. No name or register number is ever shown on screen.
- **Faculty portal** (`/faculty`): each faculty member sees only their own aggregated feedback, with question-wise scores against the department average, class breakdown, trend across cycles and comments. They can export it to Excel or print it.
- **Admin portal** (`/admin`): dashboard, **Visualize** (compare each class, staff member, year, semester, section, subject or department as a heatmap, cards, ranking or rating mix, then click to drill down), reports, faculty insights, anonymous responses, completion tracking, academic data management, bulk CSV/Excel import, filtered Excel and CSV export, print on every page, feedback cycles, questionnaire, settings and admin users.

## Quick start

Requires **Node.js 22.13 or newer**. It uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
npm start
```

Open http://localhost:3000 for students and http://localhost:3000/admin for staff.

On first start the database (`data/feedback.db`) is created and filled with an **illustrative demo institution**: 13 departments, 9 classes, 256 students, 17 faculty, and simulated feedback across two cycles.

| Account | Username | Password | Access |
| --- | --- | --- | --- |
| Super admin | `admin` | `admin123` | Everything |
| Department admin (HOD) | `hod.cse` | `hod123` | CSE data and reports only |

**Students** sign in with their register number and date of birth. The demo students below have not submitted yet (`npm run seed` prints more):

| Register no. | Date of birth |
| --- | --- |
| `24CSBS001` | 2006-03-20 |
| `24CSBS002` | 2006-11-16 |
| `24CSBS003` | 2006-05-03 |

The date can be typed as YYYY-MM-DD or DD/MM/YYYY. After 5 wrong attempts, a register number is locked for 15 minutes.

**Faculty** sign in at `/faculty` with their Staff ID (`FAC101` to `FAC117`). On first sign-in the password is also the Staff ID, and they must choose a new one. Admins can set a temporary password or reset it back to the Staff ID under Admin → Faculty.

> Change the demo passwords straight away. The dashboard shows a banner until you do.

| Command | What it does |
| --- | --- |
| `npm start` | Run the server (`PORT`, default 3000) |
| `npm run dev` | Run with auto-reload |
| `npm run seed` | **Wipe** the database and reseed the demo data |
| `npm test` | Run the API test suite |

Environment variables: `PORT`, `DB_FILE` (database path), `SEED_DEMO=0` (start with an empty institution: departments, questions and an admin only), and `SECURE_COOKIES=1` (set this when serving over HTTPS).

## How anonymity works

Student master data and feedback are kept apart by design:

| Table | Contains | Never contains |
| --- | --- | --- |
| `students` | Register number, name, class | Any rating |
| `completions` | *That* a student finished a form in a cycle, and the date | Ratings or comments |
| `feedback`, `feedback_answers` | Faculty, subject, academic context, the ten ratings, an optional comment and the date | Student ID, register number, time of day |

- A register number is only used to confirm eligibility and stop duplicate submissions.
- Feedback rows use random IDs in `WITHOUT ROWID` tables, and only a calendar date is stored. Neither insertion order nor timestamps can be used to join a response back to a completion record.
- Completion tracking shows admins **who** is still pending, never **what** anyone answered.
- Faculty reports show aggregates. Groups below a configurable threshold are flagged as "Low sample" for admins and **hidden entirely** in the faculty portal and faculty exports, so a teacher can never infer what an individual student said.
- The student portal never displays the student's name or register number, and the verification response doesn't contain them.

## Setting up a real institution

Go to **Admin → Data import** and load your data in this order:

1. Departments
2. Classes
3. Faculty
4. Subjects
5. Faculty mapping
6. Students (the template includes a required **Date of Birth** column)

Every import type has a downloadable Excel template. CSV and `.xlsx` files are both accepted, and common header variants (e.g. "Reg No", "Roll Number") are recognised. Each upload is validated and previewed as new, update, already exists, duplicate or invalid before you confirm. There are two modes:

- **Add new only:** existing records are skipped.
- **Add & update:** records are matched by their unique ID and updated.

Imports never delete data.

Validation covers:
- duplicate register numbers and staff IDs
- missing names
- unknown departments
- invalid years, semesters and sections, including a semester that doesn't belong to its year
- students assigned to classes that don't exist
- subjects mapped to the wrong department
- inactive or unknown faculty

After importing, open a **Feedback cycle** under Configuration. Only one cycle can be open at a time.

## Architecture

```
server/
  index.js      entry point: opens the DB, seeds it, starts Express
  app.js        security headers, public student API, admin auth, error handling
  admin.js      admin API: generic CRUD with department scoping, settings, reports, import/export routes
  faculty.js    faculty portal API (own data only, small groups suppressed)
  reports.js    aggregation queries (dashboard, grouped reports, faculty detail, completion)
  importer.js   CSV/XLSX parsing, validation, preview and commit
  exporter.js   multi-sheet Excel report builder (ExcelJS)
  db.js         schema, password hashing (scrypt)
  seed.js       base data plus the illustrative demo institution
public/
  index.html, js/student.js     student portal
  faculty.html, js/faculty.js   faculty portal
  admin.html, js/admin/*.js     admin single-page app (visualize.js = Visualize page)
  css/app.css                   design system (light and dark), plus student.css / admin.css
  js/core.js, js/charts.js      UI helpers and dependency-free SVG charts
test/api.test.js                end-to-end API tests (node:test)
```

**Security:**
- scrypt password hashes
- HttpOnly `SameSite=Strict` session cookies stored hashed
- a custom header is required on admin mutations
- HMAC-signed, short-lived student tokens
- rate limiting on login, verification and submission
- strict Content-Security-Policy
- server-side validation of every rating (1–10, at most one decimal place)

## Roles

- **Super admin:** the whole institution, settings, cycles, questionnaire and admin users.
- **Department admin (e.g. HOD):** data, reports, completion and exports for their own department only.
- **Faculty:** their own aggregated feedback only, through the separate faculty portal.
- **Student:** anonymous feedback for their own class's faculty.

## Export and print

- **Excel:** every report page exports a multi-sheet workbook with the filters applied. Sheets cover faculty, subject, class, department, question, year, semester, academic year, the Class × Question and Faculty × Question matrices, and the anonymous responses.
- **CSV:** Visualize and every data list (students, faculty, subjects, …) download as CSV.
- **Print:** every page has a Print button that prints in a clean light layout, headed with the institution, page, active filters and date. Use "Save as PDF" in the print dialog to get a PDF.

## Compared with the previous system

This replaces the earlier Flask/CSV app ([JaiSamyukth/Feedback-System](https://github.com/JaiSamyukth/Feedback-System)). Every feature of that system is covered:

| Previous system | This system |
| --- | --- |
| Student enters register number; rates every mapped staff member in one table (1–10) | Register number + date of birth (or register number only, configurable). Each staff–subject form is rated separately with half points, a live average and total, a review step and saved drafts |
| One submission per register number | One submission per form per cycle, tracked in a separate table that holds no answers |
| Register number stored (hashed) next to the ratings | No identifier of any kind is stored with ratings. The hashes could have been reversed by trying every register number in a batch |
| Admin: map staff and subjects for a department + semester (replacing the list) | **Map a whole class** editor (Faculty mapping page) that saves the list in one go, plus single-assignment editing and CSV/Excel import |
| Admin: quick-add a staff or subject name | Quick add inside the class mapping editor, plus full Faculty and Subjects pages |
| Admin: add students by register-number range (start–end) | **Add range** on the Students page, plus import, single add, bulk move and status |
| HOD: select department + semester → view or download the PDF report (V.S.B. format, Q1–Q10, Total /100, bar chart, references, questions, signatures, form-number footer) | **Class report (PDF)**: same format, with View PDF and Download PDF, optionally per section. Header, title, footer and signatures are editable in Settings |
| HOD: "archive" copies the CSVs to `history/` and resets | Feedback cycles keep every semester's data side by side. **Download full backup** in Settings |
| Single shared admin password, hard-coded HOD login | Individual accounts with hashed passwords: super admin, department admin (HOD scoped to their department) and faculty portal |
| 13 departments, 8 semesters, staff and subject name lists | Same departments built in. Staff and subjects carry IDs, departments and semesters. Classes add year and section |

### Bringing over the old data

```bash
npm run import-legacy -- /path/to/old/Feedback-System
```

This imports `departments.csv`, `staffs.csv`, `subjects.csv`, `students.csv`, `admin_mapping.csv` and `ratings.csv`:

- Department names are matched to the built-in departments.
- Staff and subjects get generated IDs (`STF001…`, `SUB001…`). Their department comes from the old mapping file, or "General / Unassigned" if they were never mapped.
- Students are placed in section A of their department and semester.
- Old ratings go into a closed "Legacy import" cycle, and their register-number column is discarded.

Running it again does not create duplicates. The old data has no student names or dates of birth, so after importing, either add dates of birth with Data import → Students ("Add & update"), or set Settings → Student sign-in to "Register number only".
