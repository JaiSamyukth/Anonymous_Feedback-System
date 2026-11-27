'use strict';
/**
 * Seeds reference data (departments, the ten questions, default admins) and,
 * optionally, an illustrative demo institution with classes, students,
 * faculty, subjects, mappings and simulated anonymous feedback.
 *
 *   node server/seed.js --reset     wipe the database and reseed demo data
 */
const crypto = require('node:crypto');
const { hashPassword } = require('./db');

const QUESTIONS = [
  ['How is the faculty’s approach?', 'Approach'],
  ['How has the faculty prepared for the classes?', 'Preparation'],
  ['Does the faculty inform you about your expected competencies, course outcomes?', 'Course outcomes'],
  ['How often does the faculty illustrate the concepts through examples and practical applications?', 'Examples & practice'],
  ['Whether faculty covers syllabus in time?', 'Syllabus coverage'],
  ['Do you agree that the faculty teaches content beyond syllabus?', 'Beyond syllabus'],
  ['How does the faculty communicate?', 'Communication'],
  ['Whether faculty returns answer scripts in time and produce helpful comments?', 'Answer scripts'],
  ['How does the faculty identify your strengths and encourage you with high level of challenges?', 'Strengths & challenge'],
  ['How does the faculty counsel & encourage the Students?', 'Counselling'],
];

const DEPARTMENTS = [
  [1, 'CSBS', 'Computer Science and Business Systems'],
  [2, 'CSE', 'Computer Science and Engineering'],
  [3, 'MECH', 'Mechanical Engineering'],
  [4, 'AIDS', 'Artificial Intelligence and Data Science'],
  [5, 'AIML', 'Artificial Intelligence and Machine Learning'],
  [6, 'CIVIL', 'Civil Engineering'],
  [7, 'CCE', 'Computer and Communication Engineering'],
  [8, 'BIOTECH', 'Biotechnology'],
  [9, 'BME', 'Biomedical Engineering'],
  [10, 'CHEM', 'Chemical Engineering'],
  [11, 'IT', 'Information Technology'],
  [12, 'EEE', 'Electrical and Electronics Engineering'],
  [13, 'ECE', 'Electronics and Communication Engineering'],
];

// Illustrative demo data only.
const DEMO = {
  CSBS: {
    sections: { 2: ['A'], 3: ['A', 'B'] },
    faculty: [['Dr. Meera Raghavan', 'Professor'], ['Arjun Prakash', 'Assistant Professor'], ['Kavya Srinivasan', 'Associate Professor'], ['Rahul Menon', 'Assistant Professor']],
    subjects: { 3: ['Data Structures', 'Business Communication', 'Discrete Mathematics', 'Object Oriented Programming'], 5: ['Database Management Systems', 'Artificial Intelligence', 'Financial Management', 'Software Engineering'] },
  },
  CSE: {
    sections: { 2: ['A', 'B'], 3: ['A'] },
    faculty: [['Dr. Sanjay Kumar', 'Professor'], ['Priya Natarajan', 'Associate Professor'], ['Vignesh Babu', 'Assistant Professor'], ['Anitha Joseph', 'Assistant Professor']],
    subjects: { 3: ['Algorithms', 'Computer Organization', 'Probability and Statistics', 'Digital Logic Design'], 5: ['Operating Systems', 'Computer Networks', 'Theory of Computation', 'Machine Learning'] },
  },
  IT: {
    sections: { 3: ['A'] },
    faculty: [['Dr. Lakshmi Iyer', 'Professor'], ['Karthik Raj', 'Assistant Professor'], ['Divya Shankar', 'Assistant Professor']],
    subjects: { 5: ['Web Technologies', 'Cloud Computing', 'Information Security', 'Data Analytics'] },
  },
  AIDS: {
    sections: { 2: ['A'] },
    faculty: [['Dr. Farhan Ali', 'Associate Professor'], ['Sneha Pillai', 'Assistant Professor'], ['Harish Venkat', 'Assistant Professor']],
    subjects: { 3: ['Foundations of Data Science', 'Linear Algebra', 'Python for Data Science', 'Database Design'] },
  },
  ECE: {
    sections: { 3: ['A'] },
    faculty: [['Dr. Ramesh Chandran', 'Professor'], ['Nandini Rao', 'Assistant Professor'], ['Suresh Gopal', 'Associate Professor']],
    subjects: { 5: ['Digital Signal Processing', 'Microprocessors', 'Communication Systems', 'VLSI Design'] },
  },
};

const FIRST = ['Aarav', 'Aditi', 'Akash', 'Ananya', 'Bharath', 'Deepika', 'Dhruv', 'Gayathri', 'Hari', 'Ishita', 'Janani', 'Kiran', 'Lavanya', 'Madhav', 'Nisha', 'Pranav', 'Rhea', 'Rohan', 'Sahana', 'Shreya', 'Tarun', 'Uma', 'Varun', 'Yamini', 'Zoya', 'Abhinav', 'Keerthana', 'Naveen', 'Pooja', 'Siddharth'];
const LAST = ['R', 'S', 'K', 'M', 'P', 'V', 'N', 'G', 'A', 'J'];

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedBase(db) {
  const insDept = db.prepare('INSERT OR IGNORE INTO departments(id, code, name) VALUES(?,?,?)');
  for (const d of DEPARTMENTS) insDept.run(...d);

  if (!db.get('SELECT 1 FROM questions LIMIT 1')) {
    const insQ = db.prepare('INSERT INTO questions(position, text, short) VALUES(?,?,?)');
    QUESTIONS.forEach(([text, short], i) => insQ.run(i + 1, text, short));
  }
  if (!db.get('SELECT 1 FROM admins LIMIT 1')) {
    db.run("INSERT INTO admins(username, name, password_hash, role) VALUES('admin','System Administrator',?, 'super_admin')", hashPassword('admin123'));
  }
  const defaults = {
    institution_name: 'V.S.B. Engineering College, Karur',
    institution_short: 'VSBEC',
    require_verification: '1',
    allow_comments: '1',
    min_responses: '3',
    student_auth: 'dob',
    report_title: "STUDENT'S FEEDBACK ON COURSE DELIVERY",
    report_subtitle: '(An Autonomous Institution)',
    report_footer: 'Form No. AC 14b      Rev.No. 00      Effective Date: 15/12/2017',
    report_signatures: 'Class Advisor, HOD, Principal',
  };
  for (const [k, v] of Object.entries(defaults)) if (db.getSetting(k) === null) db.setSetting(k, v);
  if (!db.get('SELECT 1 FROM cycles LIMIT 1')) {
    db.run("INSERT INTO cycles(name, academic_year, term, status, opens_on, closes_on) VALUES('2026-27 Odd Semester Feedback','2026-27','Odd','open','2026-11-15','2026-12-15')");
  }
}

function seedDemo(db) {
  const rnd = mulberry32(20261127);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const deptId = Object.fromEntries(db.all('SELECT id, code FROM departments').map((d) => [d.code, d.id]));
  const questions = db.all('SELECT id FROM questions WHERE active = 1 ORDER BY position');

  db.run("UPDATE settings SET value = 'V.S.B. Engineering College, Karur' WHERE key = 'institution_name'");
  db.run("UPDATE settings SET value = 'VSBEC' WHERE key = 'institution_short'");
  db.run("INSERT INTO cycles(name, academic_year, term, status, opens_on, closes_on) VALUES('2025-26 Even Semester Feedback','2025-26','Even','closed','2026-04-01','2026-04-30')");
  const openCycle = db.get("SELECT id FROM cycles WHERE status = 'open' ORDER BY id LIMIT 1").id;
  const prevCycle = db.get("SELECT id FROM cycles WHERE status = 'closed' ORDER BY id DESC LIMIT 1").id;

  db.run("INSERT INTO admins(username, name, password_hash, role, department_id) VALUES('hod.cse','Dr. Sanjay Kumar (HOD, CSE)',?,'dept_admin',?)", hashPassword('hod123'), deptId.CSE);

  const insFac = db.prepare('INSERT INTO faculty(staff_id, name, department_id, designation, email) VALUES(?,?,?,?,?)');
  const insSub = db.prepare('INSERT INTO subjects(code, name, department_id, semester) VALUES(?,?,?,?)');
  const insCls = db.prepare('INSERT INTO classes(department_id, year, semester, section) VALUES(?,?,?,?)');
  const insMap = db.prepare('INSERT INTO mappings(class_id, subject_id, faculty_id) VALUES(?,?,?)');
  const insStu = db.prepare('INSERT INTO students(register_no, name, department_id, class_id, admission_year, dob) VALUES(?,?,?,?,?,?)');
  const insFb = db.prepare('INSERT INTO feedback(id, cycle_id, mapping_id, faculty_id, subject_id, department_id, year, semester, section, average, comment, submitted_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const insAns = db.prepare('INSERT INTO feedback_answers(feedback_id, question_id, rating) VALUES(?,?,?)');
  const insCmp = db.prepare('INSERT INTO completions(student_id, cycle_id, mapping_id, completed_on) VALUES(?,?,?,?)');

  const comments = [
    'Explains concepts very clearly with real examples.',
    'Could share notes before class so we can prepare.',
    'Very supportive during lab sessions.',
    'Please return answer scripts a little sooner.',
    'Classes are engaging and well organised.',
    'Would appreciate more practice problems.',
    'Encourages us to ask questions — thank you!',
  ];
  let staffSeq = 100;
  const facultyQuality = new Map();

  for (const [code, spec] of Object.entries(DEMO)) {
    const d = deptId[code];
    const fac = spec.faculty.map(([name, desig]) => {
      staffSeq += 1;
      const email = name.toLowerCase().replace(/^dr\.\s*/, '').replace(/[^a-z]+/g, '.') + '@college.edu';
      const id = Number(insFac.run(`FAC${staffSeq}`, name, d, desig, email).lastInsertRowid);
      facultyQuality.set(id, 5.3 + rnd() * 3.9);
      return id;
    });
    let subjSeq = 0;
    for (const [year, sections] of Object.entries(spec.sections)) {
      const y = Number(year);
      const sem = y * 2 - 1; // odd term
      const subjIds = spec.subjects[sem].map((name) => {
        subjSeq += 1;
        return Number(insSub.run(`${code}${sem}0${subjSeq}`, name, d, sem).lastInsertRowid);
      });
      const admission = 2026 - y + 1;
      let serial = 0;
      for (const sec of sections) {
        const classId = Number(insCls.run(d, y, sem, sec).lastInsertRowid);
        const mapIds = subjIds.map((sid, i) => {
          const fid = fac[(i + sections.indexOf(sec)) % fac.length];
          return { id: Number(insMap.run(classId, sid, fid).lastInsertRowid), sid, fid };
        });
        const nStudents = 24 + Math.floor(rnd() * 10);
        for (let n = 0; n < nStudents; n++) {
          serial += 1;
          const reg = `${String(admission).slice(2)}${code}${String(serial).padStart(3, '0')}`;
          const dob = `${admission - 18}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
          const sid = Number(insStu.run(reg, `${pick(FIRST)} ${pick(LAST)}`, d, classId, admission, dob).lastInsertRowid);
          // Leave the first three students in every class untouched so the demo can be tried.
          if (serial <= 3 || (sections.indexOf(sec) > 0 && n < 3)) continue;
          for (const m of mapIds) {
            if (rnd() > 0.72) continue;
            const day = `2026-11-${String(15 + Math.floor(rnd() * 12)).padStart(2, '0')}`;
            insCmp.run(sid, openCycle, m.id, day);
            writeResponse(openCycle, m, d, y, sem, sec, day);
          }
        }
        // Historical cycle (previous semester) for trend comparison.
        for (const m of mapIds) {
          const count = 14 + Math.floor(rnd() * 10);
          for (let k = 0; k < count; k++) {
            const day = `2026-04-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
            writeResponse(prevCycle, m, d, y, sem - 1, sec, day, -0.4);
          }
        }
      }
    }
  }

  function writeResponse(cycleId, m, d, y, sem, sec, day, shift = 0) {
    const base = facultyQuality.get(m.fid) + shift;
    const ratings = questions.map((q, i) => {
      const bias = i === 5 ? -0.7 : i === 7 ? -0.5 : i === 1 ? 0.3 : 0;
      const v = base + bias + (rnd() - 0.5) * 3;
      return { qid: q.id, r: Math.min(10, Math.max(1, Math.round(v * 2) / 2)) };
    });
    const avg = Math.round((ratings.reduce((s, x) => s + x.r, 0) / ratings.length) * 100) / 100;
    const id = crypto.randomUUID();
    const comment = rnd() < 0.12 ? pick(comments) : null;
    insFb.run(id, cycleId, m.id, m.fid, m.sid, d, y, sem, sec, avg, comment, day);
    for (const x of ratings) insAns.run(id, x.qid, x.r);
  }
}

function seed(db, { demo = true } = {}) {
  db.tx(() => {
    seedBase(db);
    if (demo && !db.get('SELECT 1 FROM students LIMIT 1')) seedDemo(db);
  });
}

module.exports = { seed, QUESTIONS, DEPARTMENTS };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'feedback.db');
  if (process.argv.includes('--reset')) {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }
  const db = require('./db').open(file);
  seed(db, { demo: !process.argv.includes('--no-demo') });
  const c = (t) => db.get(`SELECT COUNT(*) n FROM ${t}`).n;
  const demo = db.all("SELECT s.register_no, s.dob FROM students s WHERE NOT EXISTS (SELECT 1 FROM completions k WHERE k.student_id = s.id) ORDER BY s.register_no LIMIT 6");
  if (demo.length) console.log('Demo student logins (register no. / date of birth):', demo.map((d) => `${d.register_no} / ${d.dob}`).join(', '));
  console.log(`Seeded ${file}: ${c('departments')} departments, ${c('classes')} classes, ${c('students')} students, ${c('faculty')} faculty, ${c('feedback')} feedback responses.`);
}
