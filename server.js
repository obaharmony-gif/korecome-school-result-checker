require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = "kcc_admin";
const TEACHER_COOKIE_NAME = "kcc_teacher";
const SESSION_HOURS = 8;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "korecome_results",

  // Local MySQL 8 connection
  ssl: false,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
});
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "results.html"));
});

// Admin dashboard shortcuts.
app.get("/admin/", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin", "admin.html"));
});
app.get("/admin.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin", "admin.html"));
});
// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf("=");
        if (i < 0) return ["", ""];
        return [
          decodeURIComponent(part.slice(0, i).trim()),
          decodeURIComponent(part.slice(i + 1)),
        ];
      })
      .filter(([key]) => key),
  );
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const secret = process.env.SESSION_SECRET || "CHANGE-ME-IN-PRODUCTION";
  const sig = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const secret = process.env.SESSION_SECRET || "CHANGE-ME-IN-PRODUCTION";
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function setSession(res, admin) {
  const token = sign({
    id: admin.id,
    username: admin.username,
    name: admin.full_name,
    exp: Date.now() + SESSION_HOURS * 3600000,
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`,
  );
}

function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

function setTeacherSession(res, teacher) {
  const token = sign({
    id: teacher.id,
    username: teacher.username,
    name: teacher.full_name,
    role: "teacher",
    exp: Date.now() + SESSION_HOURS * 3600000,
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${TEACHER_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`,
  );
}

function clearTeacherSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${TEACHER_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

function teacherAuth(req, res, next) {
  try {
    const payload = verify(parseCookies(req)[TEACHER_COOKIE_NAME]);
    if (!payload || payload.role !== "teacher")
      return res.status(401).json({ error: "Unauthorized. Please log in." });
    req.teacher = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired teacher session." });
  }
}

function auth(req, res, next) {
  try {
    const payload = verify(parseCookies(req)[COOKIE_NAME]);
    if (!payload)
      return res.status(401).json({ error: "Unauthorized. Please log in." });
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return (
      candidate.length === expected.length &&
      crypto.timingSafeEqual(candidate, expected)
    );
  } catch {
    return false;
  }
}

function grade(score) {
  if (score >= 75) return ["A1", "Excellent"];
  if (score >= 70) return ["B2", "Very Good"];
  if (score >= 65) return ["B3", "Good"];
  if (score >= 60) return ["C4", "Credit"];
  if (score >= 55) return ["C5", "Credit"];
  if (score >= 50) return ["C6", "Credit"];
  if (score >= 45) return ["D7", "Pass"];
  if (score >= 40) return ["E8", "Pass"];
  return ["F9", "Fail"];
}

function makePin() {
  return String(crypto.randomInt(100000000000, 999999999999));
}

async function ensureStructure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      code VARCHAR(20) NOT NULL UNIQUE,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  await pool.query(`
    INSERT IGNORE INTO departments (name,code,active) VALUES
      ('Science','SCI',1),('Art','ART',1),('Commercial','COM',1)`);

  const [studentDeptCol] = await pool.query("SHOW COLUMNS FROM students LIKE 'department_id'");
  if (!studentDeptCol.length) {
    await pool.query("ALTER TABLE students ADD COLUMN department_id INT NULL AFTER class_id");
  }
  const [studentDeptFk] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='students' AND COLUMN_NAME='department_id' AND REFERENCED_TABLE_NAME='departments'");
  if (!studentDeptFk.length) {
    await pool.query("ALTER TABLE students ADD CONSTRAINT fk_student_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS department_class_subjects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      class_id INT NOT NULL,
      department_id INT NOT NULL,
      subject_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_department_class_subject (class_id, department_id, subject_id),
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

  // Keep the school's A/B class naming. Existing SS 1/2/3 classes become the Science A classes.
  for (const [oldName,newName] of [['SS 1','SS1A'],['SS 2','SS2A'],['SS 3','SS3A']]) {
    const [[oldRow]] = await pool.query('SELECT id FROM classes WHERE name=? LIMIT 1',[oldName]);
    const [[newRow]] = await pool.query('SELECT id FROM classes WHERE name=? LIMIT 1',[newName]);
    if (oldRow && !newRow) await pool.query('UPDATE classes SET name=? WHERE id=?',[newName,oldRow.id]);
  }
  await pool.query("INSERT IGNORE INTO classes (name) VALUES ('SS1A'),('SS1B'),('SS2A'),('SS2B'),('SS3A'),('SS3B')");

  // A classes are Science. B classes remain mixed and must be assigned Art or Commercial per student.
  const [[science]] = await pool.query("SELECT id FROM departments WHERE code='SCI' LIMIT 1");
  if (science) {
    await pool.query(`
      UPDATE students st JOIN classes c ON c.id=st.class_id
      SET st.department_id=?
      WHERE c.name IN ('SS1A','SS2A','SS3A')`, [science.id]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS teachers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(120) NULL,
      phone VARCHAR(40) NULL,
      password_hash VARCHAR(255) NOT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_subjects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      class_id INT NOT NULL,
      subject_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_class_subject (class_id, subject_id),
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      teacher_id INT NOT NULL,
      subject_id INT NOT NULL,
      class_id INT NOT NULL,
      department_id INT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  const [teacherDeptCol] = await pool.query("SHOW COLUMNS FROM teacher_assignments LIKE 'department_id'");
  if (!teacherDeptCol.length) {
    await pool.query("ALTER TABLE teacher_assignments ADD COLUMN department_id INT NULL AFTER class_id");
  }
  const [teacherDeptFk] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='teacher_assignments' AND COLUMN_NAME='department_id' AND REFERENCED_TABLE_NAME='departments'");
  if (!teacherDeptFk.length) {
    await pool.query("ALTER TABLE teacher_assignments ADD CONSTRAINT fk_teacher_assignment_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE");
  }

  const [cols] = await pool.query(`SHOW COLUMNS FROM results LIKE 'status'`);
  if (!cols.length) {
    await pool.query(
      `ALTER TABLE results ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' AFTER remark`,
    );
    await pool.query(
      `UPDATE results SET status = CASE WHEN published=1 THEN 'PUBLISHED' ELSE 'DRAFT' END`,
    );
  }
}

async function normalizeAdmissionNumbers() {
  // Convert any old phone-based/internal identifiers to the required KCC00001 format.
  const [validRows] = await pool.query(
    `SELECT admission_number
     FROM students
     WHERE admission_number REGEXP '^KCC[0-9]{5}$'`,
  );

  let next = validRows.reduce((max, row) => {
    const n = Number(String(row.admission_number).slice(3));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0) + 1;

  const [legacyRows] = await pool.query(
    `SELECT id
     FROM students
     WHERE admission_number NOT REGEXP '^KCC[0-9]{5}$'
     ORDER BY id`,
  );

  for (const row of legacyRows) {
    let admission = `KCC${String(next).padStart(5, "0")}`;
    while (true) {
      const [[existing]] = await pool.query(
        "SELECT id FROM students WHERE admission_number=? LIMIT 1",
        [admission],
      );
      if (!existing) break;
      next += 1;
      admission = `KCC${String(next).padStart(5, "0")}`;
    }
    await pool.query("UPDATE students SET admission_number=? WHERE id=?", [admission, row.id]);
    next += 1;
  }
}

async function ensureAdmin() {
  const [tables] = await pool.query("SHOW TABLES LIKE 'admins'");
  if (!tables.length) return;
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM admins");
  if (Number(row.n) === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "ChangeMe123!";
    await pool.query(
      "INSERT INTO admins (username, full_name, password_hash) VALUES (?,?,?)",
      [username, "School Administrator", hashPassword(password)],
    );
    console.log(`Initial admin created: ${username}`);
  }
}

function duplicateMessage(error, fallback) {
  return error && error.code === "ER_DUP_ENTRY" ? fallback : error.message;
}

// Generate the next school admission number.
// Format: KCC00001, KCC00002, KCC00003 ...
async function generateAdmissionNumber() {
  const [rows] = await pool.query(
    `SELECT admission_number
     FROM students
     WHERE admission_number REGEXP '^KCC[0-9]{5}$'
     ORDER BY CAST(SUBSTRING(admission_number, 4) AS UNSIGNED) DESC
     LIMIT 1`,
  );

  let next = rows.length
    ? Number(String(rows[0].admission_number).slice(3)) + 1
    : 1;

  while (true) {
    const admission = `KCC${String(next).padStart(5, "0")}`;
    const [[existing]] = await pool.query(
      "SELECT id FROM students WHERE admission_number=? LIMIT 1",
      [admission],
    );
    if (!existing) return admission;
    next += 1;
  }
}

// ------------------------------------------------------------
// Health + public result checker
// ------------------------------------------------------------
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, message: "Server and database are working." });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/public/options", async (_req, res) => {
  try {
    const [sessions] = await pool.query(
      "SELECT id,name FROM academic_sessions WHERE active=1 ORDER BY id DESC",
    );
    const [terms] = await pool.query("SELECT id,name FROM terms ORDER BY id");
    res.json({ sessions, terms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/result/check", async (req, res) => {
  try {
    const admission = String(req.body.admission_number || "").trim().toUpperCase();
    const pin = String(req.body.pin || "").trim();
    const sessionId = Number(req.body.session_id || 0);
    const termId = Number(req.body.term_id || 0);

    if (!admission || !pin || !sessionId || !termId) {
      return res.status(400).json({
        error: "Admission number, PIN, session and term are required.",
      });
    }

    const [[token]] = await pool.query(
      `SELECT rp.id, rp.student_id, st.admission_number, st.first_name, st.last_name, st.other_name, c.name AS class_name, d.name AS department_name
       FROM result_pins rp
       JOIN students st ON st.id = rp.student_id
       JOIN classes c ON c.id = st.class_id
       LEFT JOIN departments d ON d.id = st.department_id
       WHERE st.admission_number = ? AND st.active = 1
         AND rp.pin = ? AND rp.session_id = ? AND rp.term_id = ? AND rp.active = 1
       LIMIT 1`,
      [admission, pin, sessionId, termId],
    );

    if (!token) {
      return res.status(404).json({
        error:
          "No result found. Check the admission number, PIN, session and term.",
      });
    }

    const [rows] = await pool.query(
      `SELECT r.ca_score, r.exam_score, r.total_score, r.grade, r.remark,
              s.name AS subject_name, s.code AS subject_code
       FROM results r
       JOIN subjects s ON s.id = r.subject_id
       WHERE r.student_id = ? AND r.session_id = ? AND r.term_id = ? AND r.published = 1
       ORDER BY s.name`,
      [token.student_id, sessionId, termId],
    );

    if (!rows.length)
      return res
        .status(404)
        .json({ error: "This result has not been published yet." });

    const [[session]] = await pool.query(
      "SELECT name FROM academic_sessions WHERE id=?",
      [sessionId],
    );
    const [[term]] = await pool.query("SELECT name FROM terms WHERE id=?", [
      termId,
    ]);
    const total = rows.reduce(
      (sum, row) => sum + Number(row.total_score || 0),
      0,
    );
    const average = rows.length ? total / rows.length : 0;

    await pool.query(
      "UPDATE result_pins SET use_count=use_count+1, last_used_at=NOW() WHERE id=?",
      [token.id],
    );

    res.json({
      student: {
        admission_number: token.admission_number,
        name: [token.first_name, token.other_name, token.last_name]
          .filter(Boolean)
          .join(" "),
        class_name: token.class_name,
        department_name: token.department_name || '',
      },
      session: session?.name || "",
      term: term?.name || "",
      results: rows,
      summary: {
        total: Number(total.toFixed(2)),
        average: Number(average.toFixed(2)),
        subjects: rows.length,
      },
    });
  } catch (error) {
    console.error("RESULT CHECK ERROR:", error);
    res
      .status(500)
      .json({ error: "Unable to check result.", detail: error.message });
  }
});

// ------------------------------------------------------------
// Admin auth
// ------------------------------------------------------------
app.post("/api/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || !password)
      return res
        .status(400)
        .json({ error: "Username and password are required." });

    const [[admin]] = await pool.query(
      "SELECT * FROM admins WHERE username=? AND active=1 LIMIT 1",
      [username],
    );
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    setSession(res, admin);
    res.json({
      ok: true,
      admin: { id: admin.id, username: admin.username, name: admin.full_name },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get("/api/admin/me", auth, (req, res) => {
  res.json({ admin: req.admin });
});

// ------------------------------------------------------------
// Dashboard/meta
// ------------------------------------------------------------
app.get("/api/admin/dashboard", auth, async (_req, res) => {
  try {
    const [
      studentRows,
      classRows,
      subjectRows,
      resultRows,
      publishedRows,
      pinRows,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*) AS n FROM students WHERE active=1"),
      pool.query("SELECT COUNT(*) AS n FROM classes"),
      pool.query("SELECT COUNT(*) AS n FROM subjects"),
      pool.query("SELECT COUNT(*) AS n FROM results"),
      pool.query("SELECT COUNT(*) AS n FROM results WHERE published=1"),
      pool.query("SELECT COUNT(*) AS n FROM result_pins WHERE active=1"),
    ]);

    res.json({
      students: Number(studentRows[0][0].n || 0),
      classes: Number(classRows[0][0].n || 0),
      subjects: Number(subjectRows[0][0].n || 0),
      results: Number(resultRows[0][0].n || 0),
      published: Number(publishedRows[0][0].n || 0),
      pins: Number(pinRows[0][0].n || 0),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/meta", auth, async (_req, res) => {
  try {
    const [classes] = await pool.query(
      "SELECT id,name FROM classes ORDER BY name",
    );
    const [subjects] = await pool.query(
      "SELECT id,name,code FROM subjects ORDER BY name",
    );
    const [sessions] = await pool.query(
      "SELECT id,name,active FROM academic_sessions ORDER BY id DESC",
    );
    const [terms] = await pool.query("SELECT id,name FROM terms ORDER BY id");
    const [departments] = await pool.query("SELECT id,name,code,active FROM departments WHERE active=1 ORDER BY id");
    res.json({ classes, subjects, sessions, terms, departments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Departments
// ------------------------------------------------------------
app.get("/api/admin/departments", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT id,name,code,active FROM departments WHERE active=1 ORDER BY id");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Students
// ------------------------------------------------------------
app.get("/api/admin/students", auth, async (req, res) => {
  try {
    const search = String(req.query.q || "").trim();
    const like = `%${search}%`;
    const [rows] = await pool.query(
      `SELECT st.id, st.admission_number, st.first_name, st.last_name, st.other_name,
              st.gender, st.class_id, st.department_id, st.active, st.created_at,
              c.name AS class_name, d.name AS department_name, d.code AS department_code
       FROM students st
       JOIN classes c ON c.id = st.class_id
       LEFT JOIN departments d ON d.id = st.department_id
       WHERE st.admission_number LIKE ?
          OR CONCAT_WS(' ', st.first_name, st.other_name, st.last_name) LIKE ?
       ORDER BY st.active DESC, st.id DESC
       LIMIT 1000`,
      [like, like],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/students", auth, async (req, res) => {
  try {
    const admission = String(req.body.admission_number || "").trim().toUpperCase();
    const first = String(req.body.first_name || "").trim();
    const last = String(req.body.last_name || "").trim();
    const other = String(req.body.other_name || "").trim();
    const gender = String(req.body.gender || "").trim();
    const classId = Number(req.body.class_id || 0);
    let departmentId = Number(req.body.department_id || 0) || null;

    const [[studentClass]] = await pool.query("SELECT id,name FROM classes WHERE id=? LIMIT 1", [classId]);
    if (!studentClass) return res.status(400).json({ error: "Valid class is required." });
    if (/^SS[123]A$/i.test(studentClass.name)) {
      const [[sci]] = await pool.query("SELECT id FROM departments WHERE code='SCI' LIMIT 1");
      departmentId = sci?.id || null;
    } else if (/^SS[123]B$/i.test(studentClass.name)) {
      if (!departmentId) return res.status(400).json({ error: "Select Art or Commercial for a B class student." });
      const [[dept]] = await pool.query("SELECT id FROM departments WHERE id=? AND code IN ('ART','COM') LIMIT 1", [departmentId]);
      if (!dept) return res.status(400).json({ error: "B class students can only belong to Art or Commercial." });
    } else {
      departmentId = null;
    }

    if (!/^KCC\d{5}$/.test(admission)) {
      return res.status(400).json({
        error: "Admission number must use the format KCC00001.",
      });
    }

    if (!first || !last || !classId) {
      return res.status(400).json({
        error: "First name, last name and class are required.",
      });
    }

    const [result] = await pool.query(
      "INSERT INTO students (admission_number,first_name,last_name,other_name,gender,class_id,department_id,active) VALUES (?,?,?,?,?,?,?,1)",
      [admission, first, last, other || null, gender || null, classId, departmentId],
    );

    res.status(201).json({ ok: true, id: result.insertId, admission_number: admission });
  } catch (error) {
    console.error("ADD STUDENT ERROR:", error);
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "A student with this admission number already exists."),
    });
  }
});

app.put("/api/admin/students/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const admission = String(req.body.admission_number || "").trim().toUpperCase();
    const first = String(req.body.first_name || "").trim();
    const last = String(req.body.last_name || "").trim();
    const other = String(req.body.other_name || "").trim();
    const gender = String(req.body.gender || "").trim();
    const classId = Number(req.body.class_id || 0);
    let departmentId = Number(req.body.department_id || 0) || null;
    const [[studentClass]] = await pool.query("SELECT id,name FROM classes WHERE id=? LIMIT 1", [classId]);
    if (!studentClass) return res.status(400).json({ error: "Valid class is required." });
    if (/^SS[123]A$/i.test(studentClass.name)) {
      const [[sci]] = await pool.query("SELECT id FROM departments WHERE code='SCI' LIMIT 1");
      departmentId = sci?.id || null;
    } else if (/^SS[123]B$/i.test(studentClass.name)) {
      if (!departmentId) return res.status(400).json({ error: "Select Art or Commercial for a B class student." });
      const [[dept]] = await pool.query("SELECT id FROM departments WHERE id=? AND code IN ('ART','COM') LIMIT 1", [departmentId]);
      if (!dept) return res.status(400).json({ error: "B class students can only belong to Art or Commercial." });
    } else {
      departmentId = null;
    }
    const active =
      req.body.active === 0 || req.body.active === false || req.body.active === "0"
        ? 0
        : 1;

    if (!id) return res.status(400).json({ error: "Invalid student ID." });
    if (!/^KCC\d{5}$/.test(admission)) {
      return res.status(400).json({ error: "Admission number must use the format KCC00001." });
    }
    if (!first || !last || !classId) {
      return res.status(400).json({ error: "Admission number, first name, last name and class are required." });
    }

    const [result] = await pool.query(
      `UPDATE students
       SET admission_number=?, first_name=?, last_name=?, other_name=?, gender=?, class_id=?, department_id=?, active=?
       WHERE id=?`,
      [admission, first, last, other || null, gender || null, classId, departmentId, active, id],
    );

    if (!result.affectedRows) return res.status(404).json({ error: "Student not found." });
    res.json({ ok: true });
  } catch (error) {
    console.error("UPDATE STUDENT ERROR:", error);
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "Another student already uses this admission number."),
    });
  }
});

app.patch("/api/admin/students/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const active =
      req.body.active === true ||
      req.body.active === 1 ||
      req.body.active === "1"
        ? 1
        : 0;
    const [result] = await pool.query(
      "UPDATE students SET active=? WHERE id=?",
      [active, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Student not found." });
    res.json({ ok: true, active: Boolean(active) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/admin/students/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [result] = await pool.query(
      "UPDATE students SET active=0 WHERE id=?",
      [id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Student not found." });
    res.json({ ok: true, message: "Student deactivated." });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Classes
// ------------------------------------------------------------
app.get("/api/admin/classes", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, COUNT(st.id) AS student_count
       FROM classes c
       LEFT JOIN students st ON st.class_id=c.id AND st.active=1
       GROUP BY c.id,c.name
       ORDER BY c.name`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/classes", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name)
      return res.status(400).json({ error: "Class name is required." });
    const [result] = await pool.query("INSERT INTO classes (name) VALUES (?)", [
      name,
    ]);
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "A class with this name already exists."),
    });
  }
});

app.put("/api/admin/classes/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const name = String(req.body.name || "").trim();
    if (!id || !name)
      return res
        .status(400)
        .json({ error: "Valid class ID and class name are required." });
    const [result] = await pool.query("UPDATE classes SET name=? WHERE id=?", [
      name,
      id,
    ]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Class not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "Another class already uses this name."),
    });
  }
});

app.delete("/api/admin/classes/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [[students]] = await pool.query(
      "SELECT COUNT(*) AS n FROM students WHERE class_id=?",
      [id],
    );
    if (Number(students.n) > 0) {
      return res.status(409).json({
        error:
          "This class cannot be deleted because students are assigned to it.",
      });
    }
    const [result] = await pool.query("DELETE FROM classes WHERE id=?", [id]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Class not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Subjects
// ------------------------------------------------------------
app.get("/api/admin/subjects", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.code, COUNT(r.id) AS result_count
       FROM subjects s
       LEFT JOIN results r ON r.subject_id=s.id
       GROUP BY s.id,s.name,s.code
       ORDER BY s.name`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/subjects", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "")
      .trim()
      .toUpperCase();
    if (!name)
      return res.status(400).json({ error: "Subject name is required." });
    const [result] = await pool.query(
      "INSERT INTO subjects (name,code) VALUES (?,?)",
      [name, code || null],
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(
        error,
        "A subject with this name already exists.",
      ),
    });
  }
});

app.put("/api/admin/subjects/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "")
      .trim()
      .toUpperCase();
    if (!id || !name)
      return res
        .status(400)
        .json({ error: "Valid subject ID and subject name are required." });
    const [result] = await pool.query(
      "UPDATE subjects SET name=?,code=? WHERE id=?",
      [name, code || null, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Subject not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "Another subject already uses this name."),
    });
  }
});

app.delete("/api/admin/subjects/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [[results]] = await pool.query(
      "SELECT COUNT(*) AS n FROM results WHERE subject_id=?",
      [id],
    );
    if (Number(results.n) > 0) {
      return res.status(409).json({
        error:
          "This subject cannot be deleted because result records already use it.",
      });
    }
    const [result] = await pool.query("DELETE FROM subjects WHERE id=?", [id]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Subject not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Student subjects
// ------------------------------------------------------------
app.get("/api/admin/student-subjects/:studentId", auth, async (req, res) => {
  try {
    const studentId = Number(req.params.studentId || 0);
    const [[student]] = await pool.query("SELECT class_id,department_id FROM students WHERE id=? AND active=1", [studentId]);
    if (!student) return res.status(404).json({ error: "Student not found." });
    const rows = await getApplicableSubjects(student.class_id, student.department_id);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ------------------------------------------------------------
// Class subject arrangements
// ------------------------------------------------------------
async function getApplicableSubjects(classId, departmentId) {
  const [rows] = await pool.query(`
    SELECT s.id,s.name,s.code FROM (
      SELECT cs.subject_id FROM class_subjects cs WHERE cs.class_id=?
      ${departmentId ? 'UNION SELECT dcs.subject_id FROM department_class_subjects dcs WHERE dcs.class_id=? AND dcs.department_id=?' : 'UNION SELECT dcs.subject_id FROM department_class_subjects dcs WHERE dcs.class_id=?'}
    ) x JOIN subjects s ON s.id=x.subject_id ORDER BY s.name`,
    departmentId ? [classId,classId,departmentId] : [classId,classId],
  );
  return rows;
}


app.get("/api/admin/class-subjects/:classId", auth, async (req, res) => {
  try {
    const classId = Number(req.params.classId || 0);
    if (!classId) return res.status(400).json({ error: "Invalid class ID." });
    const [rows] = await pool.query(
      `
      SELECT s.id, s.name, s.code, IF(cs.id IS NULL,0,1) AS offered
      FROM subjects s
      LEFT JOIN class_subjects cs ON cs.subject_id=s.id AND cs.class_id=?
      ORDER BY s.name`,
      [classId],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/admin/class-subjects/:classId", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const classId = Number(req.params.classId || 0);
    const subjectIds = Array.isArray(req.body.subject_ids)
      ? [...new Set(req.body.subject_ids.map(Number).filter(Boolean))]
      : [];
    if (!classId) return res.status(400).json({ error: "Invalid class ID." });
    await conn.beginTransaction();
    await conn.query("DELETE FROM class_subjects WHERE class_id=?", [classId]);
    if (subjectIds.length) {
      await conn.query(
        `INSERT INTO class_subjects (class_id,subject_id) VALUES ${subjectIds.map(() => "(?,?)").join(",")}`,
        subjectIds.flatMap((id) => [classId, id]),
      );
    }
    await conn.commit();
    res.json({ ok: true, count: subjectIds.length });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// Department subject arrangements for mixed B classes.
app.get("/api/admin/department-subjects/:classId/:departmentId", auth, async (req, res) => {
  try {
    const classId = Number(req.params.classId || 0), departmentId = Number(req.params.departmentId || 0);
    if (!classId || !departmentId) return res.status(400).json({ error: "Class and department are required." });
    const [rows] = await pool.query(`
      SELECT s.id,s.name,s.code,IF(dcs.id IS NULL,0,1) AS offered
      FROM subjects s
      LEFT JOIN department_class_subjects dcs ON dcs.subject_id=s.id AND dcs.class_id=? AND dcs.department_id=?
      ORDER BY s.name`, [classId,departmentId]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error:error.message }); }
});

app.put("/api/admin/department-subjects/:classId/:departmentId", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const classId=Number(req.params.classId||0), departmentId=Number(req.params.departmentId||0);
    const subjectIds=Array.isArray(req.body.subject_ids)?[...new Set(req.body.subject_ids.map(Number).filter(Boolean))]:[];
    if(!classId||!departmentId) return res.status(400).json({error:"Class and department are required."});
    await conn.beginTransaction();
    await conn.query("DELETE FROM department_class_subjects WHERE class_id=? AND department_id=?",[classId,departmentId]);
    if(subjectIds.length) await conn.query(`INSERT INTO department_class_subjects (class_id,department_id,subject_id) VALUES ${subjectIds.map(()=>"(?,?,?)").join(",")}`,subjectIds.flatMap(id=>[classId,departmentId,id]));
    await conn.commit(); res.json({ok:true,count:subjectIds.length});
  } catch(error){await conn.rollback();res.status(500).json({error:error.message});} finally{conn.release();}
});

// ------------------------------------------------------------
// Teacher management and assignments
// ------------------------------------------------------------
app.get("/api/admin/teachers", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT t.id,t.username,t.full_name,t.email,t.phone,t.active,
             COUNT(DISTINCT CASE WHEN ta.active=1 THEN ta.id END) AS assignment_count
      FROM teachers t LEFT JOIN teacher_assignments ta ON ta.teacher_id=t.id
      GROUP BY t.id,t.username,t.full_name,t.email,t.phone,t.active
      ORDER BY t.full_name`);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/teachers", auth, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const fullName = String(req.body.full_name || "").trim();
    const password = String(req.body.password || "");
    const email = String(req.body.email || "").trim();
    const phone = String(req.body.phone || "").trim();
    if (!username || !fullName || password.length < 8)
      return res.status(400).json({
        error:
          "Username, full name and a password of at least 8 characters are required.",
      });
    const [result] = await pool.query(
      "INSERT INTO teachers (username,full_name,email,phone,password_hash,active) VALUES (?,?,?,?,?,1)",
      [
        username,
        fullName,
        email || null,
        phone || null,
        hashPassword(password),
      ],
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(
        error,
        "A teacher with this username already exists.",
      ),
    });
  }
});

app.put("/api/admin/teachers/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0),
      username = String(req.body.username || "").trim(),
      fullName = String(req.body.full_name || "").trim();
    const email = String(req.body.email || "").trim(),
      phone = String(req.body.phone || "").trim(),
      active =
        req.body.active === 0 ||
        req.body.active === false ||
        req.body.active === "0"
          ? 0
          : 1;
    if (!id || !username || !fullName)
      return res
        .status(400)
        .json({ error: "Teacher ID, username and full name are required." });
    const password = String(req.body.password || "");
    if (password && password.length < 8)
      return res
        .status(400)
        .json({ error: "New teacher password must be at least 8 characters." });
    let sql =
      "UPDATE teachers SET username=?,full_name=?,email=?,phone=?,active=?";
    const params = [username, fullName, email || null, phone || null, active];
    if (password) {
      sql += ",password_hash=?";
      params.push(hashPassword(password));
    }
    sql += " WHERE id=?";
    params.push(id);
    const [result] = await pool.query(sql, params);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Teacher not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(
        error,
        "Another teacher already uses this username.",
      ),
    });
  }
});

app.delete("/api/admin/teachers/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [result] = await pool.query(
      "UPDATE teachers SET active=0 WHERE id=?",
      [id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Teacher not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/teacher-assignments", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ta.id,ta.teacher_id,ta.subject_id,ta.class_id,ta.department_id,ta.active,
              t.full_name teacher_name,t.username,s.name subject_name,s.code subject_code,c.name class_name,
              CASE
                WHEN d.name IS NOT NULL THEN d.name
                WHEN c.name REGEXP '^SS[123]A$' THEN 'Science'
                ELSE NULL
              END AS department_name
       FROM teacher_assignments ta
       JOIN teachers t ON t.id=ta.teacher_id
       JOIN subjects s ON s.id=ta.subject_id
       JOIN classes c ON c.id=ta.class_id
       LEFT JOIN departments d ON d.id=ta.department_id
       ORDER BY c.name,department_name,t.full_name,s.name`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/teacher-assignments", auth, async (req, res) => {
  try {
    const teacherId = Number(req.body.teacher_id || 0),
      subjectId = Number(req.body.subject_id || 0),
      classId = Number(req.body.class_id || 0);
    let departmentId = Number(req.body.department_id || 0) || null;
    if (!teacherId || !subjectId || !classId)
      return res.status(400).json({ error: "Teacher, subject and class are required." });

    const [[cls]] = await pool.query("SELECT id,name FROM classes WHERE id=? LIMIT 1", [classId]);
    if (!cls) return res.status(404).json({ error: "Class not found." });
    const isB = /^SS[123]B$/i.test(cls.name || "");
    if (isB) {
      if (!departmentId) return res.status(400).json({ error: "Select Art or Commercial for a B-class teacher assignment." });
      const [[dept]] = await pool.query("SELECT id,code FROM departments WHERE id=? AND active=1 AND code IN ('ART','COM') LIMIT 1", [departmentId]);
      if (!dept) return res.status(400).json({ error: "B classes can only use Art or Commercial departments." });
      const [[offered]] = await pool.query("SELECT id FROM department_class_subjects WHERE class_id=? AND department_id=? AND subject_id=?", [classId, departmentId, subjectId]);
      if (!offered) return res.status(400).json({ error: "Add this subject to that class/department arrangement before assigning a teacher." });
    } else {
      departmentId = null;
      const [[offered]] = await pool.query("SELECT id FROM class_subjects WHERE class_id=? AND subject_id=?", [classId, subjectId]);
      if (!offered) return res.status(400).json({ error: "Add this subject to the class subject arrangement before assigning a teacher." });
    }

    const [[duplicate]] = await pool.query(
      "SELECT id FROM teacher_assignments WHERE teacher_id=? AND subject_id=? AND class_id=? AND ((department_id IS NULL AND ? IS NULL) OR department_id=?) LIMIT 1",
      [teacherId, subjectId, classId, departmentId, departmentId],
    );
    if (duplicate) return res.status(409).json({ error: "This teacher already has that subject/class/department assignment." });

    const [r] = await pool.query(
      "INSERT INTO teacher_assignments (teacher_id,subject_id,class_id,department_id,active) VALUES (?,?,?,?,1)",
      [teacherId, subjectId, classId, departmentId],
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.delete("/api/admin/teacher-assignments/:id", auth, async (req, res) => {
  try {
    const [r] = await pool.query("DELETE FROM teacher_assignments WHERE id=?", [
      Number(req.params.id),
    ]);
    if (!r.affectedRows)
      return res.status(404).json({ error: "Assignment not found." });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// Teacher portal
// ------------------------------------------------------------
app.post("/api/teacher/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim(),
      password = String(req.body.password || "");
    const [[teacher]] = await pool.query(
      "SELECT * FROM teachers WHERE username=? AND active=1 LIMIT 1",
      [username],
    );
    if (!teacher || !verifyPassword(password, teacher.password_hash))
      return res.status(401).json({ error: "Invalid username or password." });
    setTeacherSession(res, teacher);
    res.json({
      ok: true,
      teacher: {
        id: teacher.id,
        username: teacher.username,
        name: teacher.full_name,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/teacher/logout", (req, res) => {
  clearTeacherSession(res);
  res.json({ ok: true });
});
app.get("/api/teacher/me", teacherAuth, (req, res) =>
  res.json({ teacher: req.teacher }),
);
app.get("/api/teacher/dashboard", teacherAuth, async (req, res) => {
  try {
    const [assignments] = await pool.query(
      `SELECT ta.id,ta.subject_id,ta.class_id,ta.department_id,s.name subject_name,s.code subject_code,c.name class_name,
              CASE WHEN d.name IS NOT NULL THEN d.name WHEN c.name REGEXP '^SS[123]A$' THEN 'Science' ELSE NULL END AS department_name
       FROM teacher_assignments ta
       JOIN subjects s ON s.id=ta.subject_id
       JOIN classes c ON c.id=ta.class_id
       LEFT JOIN departments d ON d.id=ta.department_id
       WHERE ta.teacher_id=? AND ta.active=1
         AND ((ta.department_id IS NULL AND EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.class_id=ta.class_id AND cs.subject_id=ta.subject_id))
           OR (ta.department_id IS NOT NULL AND EXISTS (SELECT 1 FROM department_class_subjects dcs WHERE dcs.class_id=ta.class_id AND dcs.department_id=ta.department_id AND dcs.subject_id=ta.subject_id)))
       ORDER BY c.name,department_name,s.name`,
      [req.teacher.id],
    );
    res.json({ teacher: req.teacher, assignments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/teacher/students", teacherAuth, async (req, res) => {
  try {
    const assignmentId = Number(req.query.assignment_id || 0), sessionId = Number(req.query.session_id || 0), termId = Number(req.query.term_id || 0);
    const [[a]] = await pool.query(
      `SELECT ta.*,s.name subject_name,c.name class_name,d.name department_name
       FROM teacher_assignments ta JOIN subjects s ON s.id=ta.subject_id JOIN classes c ON c.id=ta.class_id
       LEFT JOIN departments d ON d.id=ta.department_id
       WHERE ta.id=? AND ta.teacher_id=? AND ta.active=1`, [assignmentId, req.teacher.id]);
    if (!a) return res.status(403).json({ error: "You are not assigned to this subject/class/department." });
    if (!sessionId || !termId) return res.status(400).json({ error: "Session and term are required." });
    const params=[a.subject_id,sessionId,termId,a.class_id];
    let deptFilter='';
    if (a.department_id) { deptFilter=' AND st.department_id=?'; params.push(a.department_id); }
    const [students] = await pool.query(
      `SELECT st.id,st.admission_number,st.first_name,st.last_name,st.other_name,st.department_id,d.name department_name,
              r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.status,r.published
       FROM students st LEFT JOIN departments d ON d.id=st.department_id
       LEFT JOIN results r ON r.student_id=st.id AND r.subject_id=? AND r.session_id=? AND r.term_id=?
       WHERE st.class_id=? AND st.active=1${deptFilter}
       ORDER BY st.last_name,st.first_name`, params);
    res.json({ assignment: a, students });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/teacher/meta", teacherAuth, async (_req, res) => {
  try {
    const [sessions] = await pool.query("SELECT id,name,active FROM academic_sessions ORDER BY id DESC");
    const [terms] = await pool.query("SELECT id,name FROM terms ORDER BY id");
    res.json({ sessions, terms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/teacher/results", teacherAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const assignmentId = Number(req.body.assignment_id || 0), sessionId = Number(req.body.session_id || 0), termId = Number(req.body.term_id || 0), items = Array.isArray(req.body.results) ? req.body.results : [];
    const [[a]] = await conn.query("SELECT * FROM teacher_assignments WHERE id=? AND teacher_id=? AND active=1", [assignmentId, req.teacher.id]);
    if (!a) return res.status(403).json({ error: "You are not assigned to this subject/class/department." });
    if (!sessionId || !termId || !items.length) return res.status(400).json({ error: "Assignment, session, term and scores are required." });
    await conn.beginTransaction();
    for (const item of items) {
      const studentId = Number(item.student_id || 0), ca = Number(item.ca_score || 0), exam = Number(item.exam_score || 0);
      const params=[studentId,a.class_id]; let deptSql=''; if(a.department_id){deptSql=' AND department_id=?';params.push(a.department_id)}
      const [[student]] = await conn.query(`SELECT id FROM students WHERE id=? AND class_id=? AND active=1${deptSql}`, params);
      if (!student) throw Object.assign(new Error("A student does not belong to this assignment's class/department."), { statusCode: 400 });
      if (ca < 0 || ca > 40 || exam < 0 || exam > 60) throw Object.assign(new Error("CA must be 0-40 and Exam must be 0-60."), { statusCode: 400 });
      const total = Number((ca + exam).toFixed(2)); const [g, remark] = grade(total);
      await conn.query(`INSERT INTO results (student_id,subject_id,session_id,term_id,ca_score,exam_score,total_score,grade,remark,status,published)
        VALUES (?,?,?,?,?,?,?,?,?,'DRAFT',0)
        ON DUPLICATE KEY UPDATE ca_score=VALUES(ca_score),exam_score=VALUES(exam_score),total_score=VALUES(total_score),grade=VALUES(grade),remark=VALUES(remark),status=IF(results.status='PUBLISHED','PUBLISHED','DRAFT'),published=IF(results.published=1,1,0)`,
        [studentId,a.subject_id,sessionId,termId,ca,exam,total,g,remark]);
    }
    await conn.commit(); res.json({ ok: true });
  } catch (e) { await conn.rollback(); res.status(e.statusCode || 500).json({ error: e.message }); } finally { conn.release(); }
});
app.post("/api/teacher/results/submit", teacherAuth, async (req, res) => {
  try {
    const assignmentId = Number(req.body.assignment_id || 0), sessionId = Number(req.body.session_id || 0), termId = Number(req.body.term_id || 0);
    const [[a]] = await pool.query("SELECT * FROM teacher_assignments WHERE id=? AND teacher_id=? AND active=1", [assignmentId, req.teacher.id]);
    if (!a) return res.status(403).json({ error: "You are not assigned to this subject/class/department." });
    if (!sessionId || !termId) return res.status(400).json({ error: "Session and term are required." });
    const params=[a.subject_id,sessionId,termId,a.class_id]; let deptSql=''; if(a.department_id){deptSql=' AND department_id=?';params.push(a.department_id)}
    const [r] = await pool.query(`UPDATE results SET status='SUBMITTED' WHERE subject_id=? AND session_id=? AND term_id=? AND student_id IN (SELECT id FROM students WHERE class_id=? AND active=1${deptSql}) AND status<>'PUBLISHED'`, params);
    res.json({ ok: true, updated: r.affectedRows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// Academic sessions
// ------------------------------------------------------------
app.get("/api/admin/sessions", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id,name,active FROM academic_sessions ORDER BY id DESC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/sessions", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!/^\d{4}\/\d{4}$/.test(name))
      return res.status(400).json({
        error: "Use session format YYYY/YYYY, for example 2026/2027.",
      });
    const [result] = await pool.query(
      "INSERT INTO academic_sessions (name,active) VALUES (?,1)",
      [name],
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      error: duplicateMessage(error, "This academic session already exists."),
    });
  }
});

app.patch("/api/admin/sessions/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const active =
      req.body.active === true ||
      req.body.active === 1 ||
      req.body.active === "1"
        ? 1
        : 0;
    const [result] = await pool.query(
      "UPDATE academic_sessions SET active=? WHERE id=?",
      [active, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "Academic session not found." });
    res.json({ ok: true, active: Boolean(active) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Class broadsheet + teacher submission tracking
// ------------------------------------------------------------
app.get("/api/admin/broadsheet", auth, async (req, res) => {
  try {
    const classId = Number(req.query.class_id || 0);
    const sessionId = Number(req.query.session_id || 0);
    const termId = Number(req.query.term_id || 0);
    if (!classId || !sessionId || !termId)
      return res
        .status(400)
        .json({ error: "Class, session and term are required." });

    const [[cls]] = await pool.query("SELECT id,name FROM classes WHERE id=?", [
      classId,
    ]);
    if (!cls) return res.status(404).json({ error: "Class not found." });
    const departmentId = Number(req.query.department_id || 0);
    const isBClass = /^SS[123]B$/i.test(cls.name || "");
    if (isBClass && !departmentId) return res.status(400).json({ error: "Select Art or Commercial before loading a B-class broadsheet." });
    const subjects = await getApplicableSubjects(classId, departmentId || null);
    const [students] = await pool.query(
      `SELECT st.id,st.admission_number,st.first_name,st.last_name,st.other_name,st.department_id,d.name AS department_name,d.code AS department_code
       FROM students st LEFT JOIN departments d ON d.id=st.department_id
       WHERE st.class_id=? AND st.active=1 ${departmentId ? 'AND st.department_id=?' : ''}
       ORDER BY st.last_name,st.first_name,st.other_name`,
      departmentId ? [classId,departmentId] : [classId],
    );
    const [results] = await pool.query(
      `
      SELECT r.student_id,r.subject_id,r.ca_score,r.exam_score,r.total_score,r.grade,r.remark,r.status,r.published
      FROM results r JOIN students st ON st.id=r.student_id
      WHERE st.class_id=? AND st.active=1 ${departmentId ? 'AND st.department_id=?' : ''} AND r.session_id=? AND r.term_id=?`,
      departmentId ? [classId, departmentId, sessionId, termId] : [classId, sessionId, termId],
    );
    const map = {};
    for (const r of results) map[`${r.student_id}:${r.subject_id}`] = r;
    const rows = students.map((st) => ({
      ...st,
      scores: subjects.map((sub) => map[`${st.id}:${sub.id}`] || null),
    }));
    res.json({ class: cls, department_id: departmentId || null, subjects, students: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/submission-tracking", auth, async (req, res) => {
  try {
    const sessionId = Number(req.query.session_id || 0), termId = Number(req.query.term_id || 0);
    if (!sessionId || !termId) return res.status(400).json({ error: "Session and term are required." });
    const [rows] = await pool.query(`
      SELECT ta.id,ta.teacher_id,ta.subject_id,ta.class_id,ta.department_id,
        t.full_name AS teacher_name,t.username,s.name AS subject_name,s.code AS subject_code,c.name AS class_name,
        CASE WHEN d.name IS NOT NULL THEN d.name WHEN c.name REGEXP '^SS[123]A$' THEN 'Science' ELSE NULL END AS department_name,
        COUNT(DISTINCT st.id) AS student_count,
        COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN st.id END) AS entered_count,
        COUNT(DISTINCT CASE WHEN r.status='SUBMITTED' OR r.status='PUBLISHED' THEN st.id END) AS submitted_count,
        COUNT(DISTINCT CASE WHEN r.status='PUBLISHED' OR r.published=1 THEN st.id END) AS published_count
      FROM teacher_assignments ta
      JOIN teachers t ON t.id=ta.teacher_id JOIN subjects s ON s.id=ta.subject_id JOIN classes c ON c.id=ta.class_id
      LEFT JOIN departments d ON d.id=ta.department_id
      LEFT JOIN students st ON st.class_id=ta.class_id AND st.active=1 AND (ta.department_id IS NULL OR st.department_id=ta.department_id)
      LEFT JOIN results r ON r.student_id=st.id AND r.subject_id=ta.subject_id AND r.session_id=? AND r.term_id=?
      WHERE ta.active=1
      GROUP BY ta.id,ta.teacher_id,ta.subject_id,ta.class_id,ta.department_id,t.full_name,t.username,s.name,s.code,c.name,d.name
      ORDER BY c.name,department_name,t.full_name,s.name`, [sessionId,termId]);
    const data = rows.map(r => ({...r,status:
      Number(r.student_count) > 0 && Number(r.published_count) >= Number(r.student_count) ? 'PUBLISHED' :
      Number(r.student_count) > 0 && Number(r.submitted_count) >= Number(r.student_count) ? 'SUBMITTED' :
      Number(r.entered_count) > 0 ? 'IN PROGRESS' : 'NOT STARTED'}));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ------------------------------------------------------------
// Results
// ------------------------------------------------------------
app.get("/api/admin/results", auth, async (req, res) => {
  try {
    const studentId = Number(req.query.student_id || 0);
    const sessionId = Number(req.query.session_id || 0);
    const termId = Number(req.query.term_id || 0);
    if (!studentId || !sessionId || !termId) return res.json([]);

    const [rows] = await pool.query(
      `SELECT r.*, s.name AS subject_name, s.code AS subject_code
       FROM results r
       JOIN subjects s ON s.id=r.subject_id
       JOIN students st ON st.id=r.student_id
       WHERE r.student_id=? AND r.session_id=? AND r.term_id=?
       ORDER BY s.name`,
      [studentId, sessionId, termId],
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/results", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const studentId = Number(req.body.student_id || 0);
    const sessionId = Number(req.body.session_id || 0);
    const termId = Number(req.body.term_id || 0);
    const results = req.body.results;

    if (!studentId || !sessionId || !termId || !Array.isArray(results)) {
      return res
        .status(400)
        .json({ error: "Student, session, term and results are required." });
    }

    const [[student]] = await conn.query(
      "SELECT class_id FROM students WHERE id=? AND active=1",
      [studentId],
    );
    if (!student) return res.status(404).json({ error: "Student not found." });
    await conn.beginTransaction();
    for (const item of results) {
      const subjectId = Number(item.subject_id || 0);
      if (!subjectId) continue;
      const ca = Number(item.ca_score || 0);
      const exam = Number(item.exam_score || 0);
      if (!Number.isFinite(ca) || ca < 0 || ca > 40)
        throw new Error("CA scores must be between 0 and 40.");
      if (!Number.isFinite(exam) || exam < 0 || exam > 60)
        throw new Error("Exam scores must be between 0 and 60.");
      const [[dept]] = await conn.query("SELECT department_id FROM students WHERE id=?", [studentId]);
      const [deptOffered] = dept?.department_id ? await conn.query("SELECT id FROM department_class_subjects WHERE class_id=? AND department_id=? AND subject_id=?", [student.class_id,dept.department_id,subjectId]) : [[]];
      const [classOffered] = await conn.query("SELECT id FROM class_subjects WHERE class_id=? AND subject_id=?", [student.class_id, subjectId]);
      if (!deptOffered.length && !classOffered.length) throw new Error("This subject is not offered for the student’s class and department.");
      const total = ca + exam;
      const [letter, remark] = grade(total);

      await conn.query(
        `INSERT INTO results
           (student_id,subject_id,session_id,term_id,ca_score,exam_score,total_score,grade,remark,status,published)
         VALUES (?,?,?,?,?,?,?,?,?,'DRAFT',0)
         ON DUPLICATE KEY UPDATE
           ca_score=VALUES(ca_score), exam_score=VALUES(exam_score), total_score=VALUES(total_score),
           grade=VALUES(grade), remark=VALUES(remark), status=IF(results.status='PUBLISHED','PUBLISHED','DRAFT'), published=IF(results.published=1,1,0)`,
        [
          studentId,
          subjectId,
          sessionId,
          termId,
          ca,
          exam,
          total,
          letter,
          remark,
        ],
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    res.status(400).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.post("/api/admin/results/publish", auth, async (req, res) => {
  try {
    const studentId = Number(req.body.student_id || 0);
    const sessionId = Number(req.body.session_id || 0);
    const termId = Number(req.body.term_id || 0);
    const published =
      req.body.published === true ||
      req.body.published === 1 ||
      req.body.published === "1";
    if (!studentId || !sessionId || !termId)
      return res
        .status(400)
        .json({ error: "Student, session and term are required." });

    const [result] = await pool.query(
      "UPDATE results SET published=?, status=? WHERE student_id=? AND session_id=? AND term_id=?",
      [
        published ? 1 : 0,
        published ? "PUBLISHED" : "DRAFT",
        studentId,
        sessionId,
        termId,
      ],
    );
    res.json({ ok: true, changed: result.affectedRows, published });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Result PINs
// ------------------------------------------------------------
app.get("/api/admin/pins", auth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT rp.id, rp.student_id, rp.session_id, rp.term_id, rp.pin, rp.active, rp.use_count,
              rp.last_used_at, rp.created_at, st.admission_number,
              CONCAT_WS(' ',st.first_name,st.other_name,st.last_name) AS student_name,
              a.name AS session_name, t.name AS term_name
       FROM result_pins rp
       JOIN students st ON st.id=rp.student_id
       JOIN academic_sessions a ON a.id=rp.session_id
       JOIN terms t ON t.id=rp.term_id
       ORDER BY rp.id DESC LIMIT 1000`,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/pins", auth, async (req, res) => {
  try {
    const studentId = Number(req.body.student_id || 0);
    const sessionId = Number(req.body.session_id || 0);
    const termId = Number(req.body.term_id || 0);
    if (!studentId || !sessionId || !termId)
      return res
        .status(400)
        .json({ error: "Student, session and term are required." });

    let pin = "";
    for (let i = 0; i < 8; i++) {
      pin = makePin();
      try {
        await pool.query(
          `INSERT INTO result_pins (student_id,session_id,term_id,pin,active)
           VALUES (?,?,?,?,1)
           ON DUPLICATE KEY UPDATE pin=VALUES(pin), active=1, use_count=0, last_used_at=NULL`,
          [studentId, sessionId, termId, pin],
        );
        return res.json({ ok: true, pin });
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY" || i === 7) throw error;
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/admin/pins/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const active =
      req.body.active === true ||
      req.body.active === 1 ||
      req.body.active === "1"
        ? 1
        : 0;
    const [result] = await pool.query(
      "UPDATE result_pins SET active=? WHERE id=?",
      [active, id],
    );
    if (!result.affectedRows)
      return res.status(404).json({ error: "PIN not found." });
    res.json({ ok: true, active: Boolean(active) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/admin/pins/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const [result] = await pool.query("DELETE FROM result_pins WHERE id=?", [
      id,
    ]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "PIN not found." });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------
// Account settings
// ------------------------------------------------------------
app.post("/api/admin/change-password", auth, async (req, res) => {
  try {
    const current = String(req.body.current_password || "");
    const next = String(req.body.new_password || "");
    if (!current || !next)
      return res
        .status(400)
        .json({ error: "Current and new password are required." });
    if (next.length < 8)
      return res
        .status(400)
        .json({ error: "New password must be at least 8 characters." });

    const [[admin]] = await pool.query(
      "SELECT id,password_hash FROM admins WHERE id=? LIMIT 1",
      [req.admin.id],
    );
    if (!admin || !verifyPassword(current, admin.password_hash))
      return res.status(400).json({ error: "Current password is incorrect." });
    await pool.query("UPDATE admins SET password_hash=? WHERE id=?", [
      hashPassword(next),
      req.admin.id,
    ]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/admin", (_req, res) => res.redirect("/admin/login.html"));

// API 404 must be after all API routes.
app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found.",
    method: req.method,
    path: req.originalUrl,
  });
});

app.use((error, _req, res, _next) => {
  console.error("UNHANDLED SERVER ERROR:", error);
  res.status(500).json({ error: "Internal server error." });
});

async function startServer() {
  await pool.query("SELECT 1");
  await ensureStructure();
  await normalizeAdmissionNumbers();
  await ensureAdmin();
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log("Database connection successful.");
      console.log(`Korecome Result Checker running on http://localhost:${PORT}`);
      console.log(`Admin dashboard: http://localhost:${PORT}/admin/`);
      console.log(`Teacher portal: http://localhost:${PORT}/teacher/`);
    });
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("FAILED TO START SERVER:", error);
    process.exit(1);
  });
}

module.exports = app;
