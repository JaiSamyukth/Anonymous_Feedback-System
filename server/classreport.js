'use strict';
/**
 * Official class feedback report ("Student's Feedback on Course Delivery"),
 * reproducing the institution's printed form used by the previous system:
 * header, academic info line, staff × Q1–Q10 + Total (/100) table, a bar chart of
 * totals by reference (S1, S2, …), references, the question list, signature
 * lines and the form-number footer on every page.
 */
const PDFDocument = require('pdfkit');
const reports = require('./reports');
const { toRoman } = require('./util');

/** Rows for one class: each faculty-subject pair with per-question averages. */
function classReportData(db, f) {
  const w = reports.where(db, f);
  const questions = db.all('SELECT id, position, text, short FROM questions WHERE active = 1 ORDER BY position, id');
  const pairs = db.all(
    `SELECT f.faculty_id, f.subject_id, fa.name AS staff_name, fa.designation, s.name AS subject, s.code AS subject_code,
            COUNT(*) AS responses, AVG(f.average) AS average
       ${reports.FROM} JOIN faculty fa ON fa.id = f.faculty_id JOIN subjects s ON s.id = f.subject_id
       ${w.sql} GROUP BY f.faculty_id, f.subject_id ORDER BY s.name, fa.name`,
    ...w.params,
  );
  const cells = db.all(
    `SELECT f.faculty_id, f.subject_id, a.question_id, AVG(a.rating) AS avg
       ${reports.FROM} JOIN feedback_answers a ON a.feedback_id = f.id
       ${w.sql} GROUP BY f.faculty_id, f.subject_id, a.question_id`,
    ...w.params,
  );
  const key = (r) => `${r.faculty_id}|${r.subject_id}`;
  const map = new Map();
  for (const c of cells) {
    if (!map.has(key(c))) map.set(key(c), {});
    map.get(key(c))[c.question_id] = c.avg;
  }
  const rows = pairs.map((p, i) => {
    const qs = questions.map((q) => map.get(key(p))?.[q.id] ?? null);
    const total = qs.reduce((s, v) => s + (v || 0), 0) * (10 / Math.max(questions.length, 1)); // out of 100
    return { ...p, reference: `S${i + 1}`, scores: qs.map((v) => reports.round(v)), total: reports.round(total, 1), average: reports.round(p.average) };
  });
  const cycle = w.cycle ? db.get('SELECT * FROM cycles WHERE id = ?', w.cycle) : null;
  const dept = f.department_id ? db.get('SELECT * FROM departments WHERE id = ?', f.department_id) : null;
  const year = f.year || (f.semester ? Math.ceil(f.semester / 2) : null);
  return {
    institution: db.getSetting('institution_name'),
    subtitle: db.getSetting('report_subtitle', ''),
    title: db.getSetting('report_title', "STUDENT'S FEEDBACK ON COURSE DELIVERY"),
    footer: db.getSetting('report_footer', ''),
    signatures: (db.getSetting('report_signatures', 'Class Advisor, HOD, Principal') || '').split(',').map((s) => s.trim()).filter(Boolean),
    academicYear: cycle?.academic_year || f.academic_year || '',
    cycle: cycle?.name || 'All cycles',
    branch: dept ? dept.name : 'All departments',
    departmentCode: dept?.code || '',
    semester: f.semester ? toRoman(f.semester) : 'All',
    year: year ? toRoman(year) : 'All',
    section: f.section || 'All',
    responses: rows.reduce((s, r) => s + r.responses, 0),
    questions,
    rows,
  };
}

function buildPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 28, bottom: 46, left: 24, right: 24 }, bufferPages: true, info: { Title: `${data.title} — ${data.branch}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;
    const center = (text, size, bold) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(text, L, doc.y, { width: W, align: 'center' });

    center(data.institution.toUpperCase(), 13, true);
    if (data.subtitle) center(data.subtitle, 10);
    center(data.title, 10, true);
    doc.moveDown(0.3);
    center(`Academic year: ${data.academicYear || '—'}     Branch: ${data.branch}     Semester: ${data.semester}     Year: ${data.year}     Section: ${data.section}`, 8.5);
    center(`${data.cycle} · ${data.responses} anonymous response${data.responses === 1 ? '' : 's'} · ratings on a 1–10 scale, Total out of 100`, 7.5);
    doc.moveDown(0.6);

    // ---- table
    const nQ = data.questions.length;
    const qW = 27;
    const totW = 34;
    const nameW = (W - nQ * qW - totW) * 0.5;
    const subW = W - nQ * qW - totW - nameW;
    const cols = [nameW, subW, ...Array(nQ).fill(qW), totW];
    const header = ['Staff Name', 'Subject', ...data.questions.map((q) => `Q${q.position}`), 'Total'];
    const drawRow = (cells, y, { bold = false, fill = null, h = 15 } = {}) => {
      let x = L;
      cells.forEach((c, i) => {
        if (fill) doc.rect(x, y, cols[i], h).fill(fill);
        doc.lineWidth(0.5).strokeColor('#000').rect(x, y, cols[i], h).stroke();
        doc.fillColor(fill ? '#fff' : '#000').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
          .text(String(c), x + 2, y + (h - 8) / 2, { width: cols[i] - 4, align: i < 2 ? 'left' : 'center', lineBreak: false, ellipsis: true });
        x += cols[i];
      });
      doc.fillColor('#000');
    };
    let y = doc.y;
    drawRow(header, y, { bold: true, fill: '#555555' });
    y += 15;
    for (const r of data.rows) {
      if (y > doc.page.height - 120) { doc.addPage(); y = doc.page.margins.top; drawRow(header, y, { bold: true, fill: '#555555' }); y += 15; }
      drawRow([r.staff_name, r.subject, ...r.scores.map((v) => (v === null ? '—' : v.toFixed(1))), r.total.toFixed(1)], y);
      y += 15;
    }
    if (!data.rows.length) { doc.font('Helvetica-Oblique').fontSize(9).text('No feedback has been recorded for this selection.', L, y + 6); y += 24; }
    doc.y = y + 10;

    // ---- bar chart of totals (out of 100)
    if (data.rows.length) {
      const chartH = 150;
      if (doc.y + chartH + 30 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const top = doc.y + 6;
      const left = L + 26;
      const cw = W - 30;
      doc.font('Helvetica').fontSize(7).fillColor('#333');
      for (let t = 0; t <= 100; t += 20) {
        const yy = top + chartH - (t / 100) * chartH;
        doc.strokeColor('#cccccc').lineWidth(0.4).dash(2, { space: 2 }).moveTo(left, yy).lineTo(left + cw, yy).stroke().undash();
        doc.text(String(t), L, yy - 3, { width: 22, align: 'right' });
      }
      const n = data.rows.length;
      const slot = cw / n;
      const bw = Math.min(42, slot * 0.6);
      data.rows.forEach((r, i) => {
        const hh = (r.total / 100) * chartH;
        const x = left + i * slot + (slot - bw) / 2;
        doc.rect(x, top + chartH - hh, bw, hh).fill('#4f46e5');
        doc.fillColor('#000').fontSize(7).text(r.total.toFixed(1), x - 6, top + chartH - hh - 9, { width: bw + 12, align: 'center' });
        doc.text(r.reference, x - 6, top + chartH + 3, { width: bw + 12, align: 'center' });
      });
      doc.strokeColor('#000').lineWidth(0.6).moveTo(left, top + chartH).lineTo(left + cw, top + chartH).stroke();
      doc.y = top + chartH + 18;
    }

    // ---- references & questions
    const ensure = (h) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
    ensure(30);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text('References:', L, doc.y);
    doc.font('Helvetica').fontSize(7.8);
    for (const r of data.rows) { ensure(11); doc.text(`${r.reference}: ${r.staff_name} - ${r.subject}  (${r.responses} responses)`, L + 16, doc.y); }
    doc.moveDown(0.5);
    ensure(14 * nQ);
    for (const q of data.questions) doc.font('Helvetica').fontSize(7.8).text(`Q${q.position}: ${q.text}`, L, doc.y, { width: W });

    // ---- signatures
    ensure(70);
    doc.y += 46;
    const sw = W / Math.max(data.signatures.length, 1);
    const sy = doc.y;
    data.signatures.forEach((s, i) => doc.font('Helvetica').fontSize(8.5).text(s, L + i * sw, sy, { width: sw, align: 'center' }));

    // ---- footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // allow writing in the footer area without triggering a new page
      const fy = doc.page.height - 26;
      doc.font('Helvetica').fontSize(6.8).fillColor('#777');
      if (data.footer) doc.text(data.footer, L, fy, { width: W, align: 'center', lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, L, fy + 9, { width: W, align: 'right', lineBreak: false });
      doc.fillColor('#000');
    }
    doc.end();
  });
}

module.exports = { classReportData, buildPdf };
