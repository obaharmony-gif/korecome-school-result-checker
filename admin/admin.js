const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let META = {
  classes: [],
  subjects: [],
  sessions: [],
  terms: [],
  departments: [],
};
let STUDENTS = [];
let CLASSES = [];
let SUBJECTS = [];
let PINS = [];
let TEACHERS = [];
let ASSIGNMENTS = [];
let ARRANGEMENT = [];
let BROADSHEET = [];
let SUBMISSIONS = [];

function esc(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[c],
  );
}

function notify(text, type = "success") {
  const host = $("#globalMsg");
  if (!host) return;
  const id = `msg-${Date.now()}`;
  host.insertAdjacentHTML(
    "beforeend",
    `<div class="msg ${type}" id="${id}">${esc(text)}</div>`,
  );
  setTimeout(() => document.getElementById(id)?.remove(), 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.href = "login.html";
    throw new Error("Your session has expired.");
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function optionHtml(
  list,
  label = (x) => x.name,
  includeBlank = false,
  blankText = "Select",
) {
  const first = includeBlank
    ? `<option value="">${esc(blankText)}</option>`
    : "";
  return (
    first +
    list
      .map((x) => `<option value="${x.id}">${esc(label(x))}</option>`)
      .join("")
  );
}

function fullName(student) {
  return [student.first_name, student.other_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function setView(viewName) {
  $$("[data-view]").forEach((button) =>
    button.classList.toggle("active", button.dataset.view === viewName),
  );
  $$(".view").forEach((view) =>
    view.classList.toggle("active", view.id === viewName),
  );
  const activeButton = $(`[data-view="${viewName}"]`);
  $("#pageTitle").textContent =
    activeButton?.querySelector("span")?.textContent ||
    activeButton?.textContent ||
    "Dashboard";
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeSidebar() {
  $("#sidebar")?.classList.remove("open");
  $("#sidebarOverlay")?.classList.remove("show");
}

async function loadMeta() {
  META = await api("/api/admin/meta");

  $("#sClass").innerHTML = optionHtml(
    META.classes,
    (x) => x.name,
    true,
    "Select class",
  );
  if ($("#sDepartment"))
    $("#sDepartment").innerHTML = optionHtml(
      META.departments || [],
      (x) => x.name,
      true,
      "Select department",
    );
  if ($("#studentDepartmentFilter"))
    $("#studentDepartmentFilter").innerHTML = optionHtml(
      META.departments || [],
      (x) => x.name,
      true,
      "All Departments",
    );
  if ($("#arrangementDepartment"))
    $("#arrangementDepartment").innerHTML = optionHtml(
      META.departments || [],
      (x) => x.name,
      true,
      "Select department",
    );
  if ($("#arrangementClass"))
    $("#arrangementClass").innerHTML = optionHtml(
      META.classes,
      (x) => x.name,
      true,
      "Select class",
    );
  if ($("#assignmentClass"))
    $("#assignmentClass").innerHTML = optionHtml(
      META.classes,
      (x) => x.name,
      true,
      "Select class",
    );
  if ($("#assignmentDepartment"))
    $("#assignmentDepartment").innerHTML = optionHtml(
      (META.departments || []).filter((d) => ["ART", "COM"].includes(d.code)),
      (x) => x.name,
      true,
      "Select department",
    );
  if ($("#assignmentSubject"))
    $("#assignmentSubject").innerHTML = optionHtml(
      META.subjects,
      (x) => x.name,
      true,
      "Select subject",
    );
  if ($("#assignmentTeacher"))
    $("#assignmentTeacher").innerHTML = optionHtml(
      TEACHERS,
      (x) => `${x.full_name} — ${x.username}`,
      true,
      "Select teacher",
    );

  const activeStudents = STUDENTS.filter((s) => Number(s.active) === 1);
  const studentOptions = optionHtml(
    activeStudents,
    (s) => `${s.admission_number} — ${fullName(s)}`,
    true,
    "Select student",
  );
  $("#rStudent").innerHTML = studentOptions;
  $("#pStudent").innerHTML = studentOptions;

  const sessionOptions = optionHtml(
    META.sessions,
    (x) => `${x.name}${Number(x.active) ? "" : " (inactive)"}`,
    true,
    "Select session",
  );
  $("#rSession").innerHTML = sessionOptions;
  $("#pSession").innerHTML = sessionOptions;

  const termOptions = optionHtml(
    META.terms,
    (x) => x.name,
    true,
    "Select term",
  );
  $("#rTerm").innerHTML = termOptions;
  $("#pTerm").innerHTML = termOptions;
  if ($("#bClass"))
    $("#bClass").innerHTML = optionHtml(
      META.classes,
      (x) => x.name,
      true,
      "Select class",
    );
  if ($("#bDepartment"))
    $("#bDepartment").innerHTML =
      '<option value="">Select department</option>' +
      (META.departments || [])
        .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
        .join("");
  if ($("#bSession")) $("#bSession").innerHTML = sessionOptions;
  if ($("#bTerm")) $("#bTerm").innerHTML = termOptions;
  if ($("#tSession")) $("#tSession").innerHTML = sessionOptions;
  if ($("#tTerm")) $("#tTerm").innerHTML = termOptions;

  renderSessions(META.sessions);
}

async function loadStats() {
  const data = await api("/api/admin/dashboard");
  $("#statStudents").textContent = data.students ?? 0;
  $("#statClasses").textContent = data.classes ?? 0;
  $("#statSubjects").textContent = data.subjects ?? 0;
  $("#statResults").textContent = data.results ?? 0;
  $("#statPublished").textContent = data.published ?? 0;
  $("#statPins").textContent = data.pins ?? 0;
  if ($("#statDepartments"))
    $("#statDepartments").textContent = META.departments?.length ?? 0;
}

async function loadStudents(search = "") {
  STUDENTS = await api(`/api/admin/students?q=${encodeURIComponent(search)}`);
  renderStudents();

  const activeStudents = STUDENTS.filter((s) => Number(s.active) === 1);
  const options = optionHtml(
    activeStudents,
    (s) => `${s.admission_number} — ${fullName(s)}`,
    true,
    "Select student",
  );
  $("#rStudent").innerHTML = options;
  $("#pStudent").innerHTML = options;
}

function renderStudents() {
  const body = $("#studentRows");
  const deptFilter = Number($("#studentDepartmentFilter")?.value || 0);
  const visible = deptFilter
    ? STUDENTS.filter((s) => Number(s.department_id) === deptFilter)
    : STUDENTS;
  if (!visible.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="muted">No students found.</td></tr>';
    return;
  }

  body.innerHTML = visible
    .map(
      (s) => `
    <tr>
      <td><strong>${esc(s.admission_number)}</strong></td>
      <td>${esc(fullName(s))}</td>
      <td>${esc(s.class_name || "-")}</td>
      <td>${esc(s.department_name || "-")}</td>
      <td>${esc(s.gender || "-")}</td>
      <td><span class="status-badge ${Number(s.active) ? "active" : "inactive"}">${Number(s.active) ? "Active" : "Inactive"}</span></td>
      <td class="actions-col"><div class="table-actions">
        <button class="table-btn" data-student-edit="${s.id}"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="table-btn ${Number(s.active) ? "danger" : ""}" data-student-status="${s.id}" data-active="${Number(s.active) ? 0 : 1}">${Number(s.active) ? "Deactivate" : "Activate"}</button>
      </div></td>
    </tr>
  `,
    )
    .join("");
}

function resetStudentForm() {
  $("#studentForm").reset();
  $("#studentId").value = "";
  $("#studentFormTitle").textContent = "Add Student";
  $("#saveStudent").innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Save Student';
}

function editStudent(id) {
  const student = STUDENTS.find((s) => Number(s.id) === Number(id));
  if (!student) return;
  $("#studentId").value = student.id;
  $("#sAdmission").value = student.admission_number || "";
  $("#sFirst").value = student.first_name || "";
  $("#sLast").value = student.last_name || "";
  $("#sOther").value = student.other_name || "";
  $("#sGender").value = student.gender || "";
  $("#sClass").value = student.class_id || "";
  $("#sDepartment").value = student.department_id || "";
  updateStudentDepartmentUI();
  $("#studentFormTitle").textContent = "Edit Student";
  $("#saveStudent").innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Update Student';
  $("#studentFormPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateStudentDepartmentUI() {
  const cls = META.classes.find(
    (x) => Number(x.id) === Number($("#sClass")?.value || 0),
  );
  const isA = /^SS[123]A$/i.test(cls?.name || "");
  const isB = /^SS[123]B$/i.test(cls?.name || "");
  const field = $("#studentDepartmentField");
  const select = $("#sDepartment");
  if (!field || !select) return;
  field.style.display = isB || isA ? "" : "none";
  select.disabled = !isB;
  select.required = isB;
  if (isA) {
    const sci = (META.departments || []).find((d) => d.code === "SCI");
    select.value = sci ? String(sci.id) : "";
    select.disabled = true;
    $("#studentDepartmentHint").textContent =
      "Science is automatic for A classes.";
  } else if (isB) {
    if (
      !["ART", "COM"].includes(
        (META.departments || []).find(
          (d) => Number(d.id) === Number(select.value || 0),
        )?.code,
      )
    )
      select.value = "";
    $("#studentDepartmentHint").textContent =
      "B classes are mixed. Select Art or Commercial.";
  } else {
    select.value = "";
    $("#studentDepartmentHint").textContent =
      "Departments apply only to the senior A/B classes.";
  }
}

async function saveStudent(event) {
  event.preventDefault();
  const id = Number($("#studentId").value || 0);
  const current = STUDENTS.find((s) => Number(s.id) === id);
  const payload = {
    admission_number: $("#sAdmission").value.trim().toUpperCase(),
    first_name: $("#sFirst").value.trim(),
    last_name: $("#sLast").value.trim(),
    other_name: $("#sOther").value.trim(),
    gender: $("#sGender").value,
    class_id: Number($("#sClass").value || 0),
    department_id: Number($("#sDepartment").value || 0) || null,
    active: current ? Number(current.active) : 1,
  };

  if (!/^KCC\d{5}$/.test(payload.admission_number)) {
    return notify("Admission number must use the format KCC00001.", "error");
  }

  try {
    await api(
      id ? `/api/admin/students/${id}` : "/api/admin/students",
      jsonOptions(id ? "PUT" : "POST", payload),
    );
    notify(
      id ? "Student updated successfully." : "Student added successfully.",
    );
    resetStudentForm();
    await Promise.all([loadStudents($("#studentSearch").value), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function setStudentStatus(id, active) {
  const action = Number(active) ? "activate" : "deactivate";
  if (!confirm(`Are you sure you want to ${action} this student?`)) return;
  try {
    await api(
      `/api/admin/students/${id}/status`,
      jsonOptions("PATCH", { active: Number(active) }),
    );
    notify(`Student ${action}d successfully.`);
    await Promise.all([loadStudents($("#studentSearch").value), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function loadClasses() {
  CLASSES = await api("/api/admin/classes");
  const body = $("#classRows");
  body.innerHTML = CLASSES.length
    ? CLASSES.map(
        (item) => `
    <tr><td><strong>${esc(item.name)}</strong></td><td>${Number(item.student_count || 0)}</td><td class="actions-col"><div class="table-actions">
      <button class="table-btn" data-class-edit="${item.id}"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="table-btn danger" data-class-delete="${item.id}"><i class="fa-solid fa-trash"></i> Delete</button>
    </div></td></tr>`,
      ).join("")
    : '<tr><td colspan="3" class="muted">No classes found.</td></tr>';
}

function resetClassForm() {
  $("#classForm").reset();
  $("#classId").value = "";
  $("#classFormTitle").textContent = "Add Class";
  $("#saveClass").textContent = "Save Class";
}

async function saveClass(event) {
  event.preventDefault();
  const id = Number($("#classId").value || 0);
  const name = $("#className").value.trim();
  try {
    await api(
      id ? `/api/admin/classes/${id}` : "/api/admin/classes",
      jsonOptions(id ? "PUT" : "POST", { name }),
    );
    notify(id ? "Class updated." : "Class added.");
    resetClassForm();
    await Promise.all([
      loadClasses(),
      loadMeta(),
      loadStats(),
      loadStudents($("#studentSearch").value),
    ]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function deleteClass(id) {
  if (
    !confirm(
      "Delete this class? This is only allowed when no students are assigned to it.",
    )
  )
    return;
  try {
    await api(`/api/admin/classes/${id}`, { method: "DELETE" });
    notify("Class deleted.");
    await Promise.all([loadClasses(), loadMeta(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function loadSubjects() {
  SUBJECTS = await api("/api/admin/subjects");
  const body = $("#subjectRows");
  body.innerHTML = SUBJECTS.length
    ? SUBJECTS.map(
        (item) => `
    <tr><td><strong>${esc(item.name)}</strong></td><td>${esc(item.code || "-")}</td><td>${Number(item.result_count || 0)}</td><td class="actions-col"><div class="table-actions">
      <button class="table-btn" data-subject-edit="${item.id}"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="table-btn danger" data-subject-delete="${item.id}"><i class="fa-solid fa-trash"></i> Delete</button>
    </div></td></tr>`,
      ).join("")
    : '<tr><td colspan="4" class="muted">No subjects found.</td></tr>';
}

function resetSubjectForm() {
  $("#subjectForm").reset();
  $("#subjectId").value = "";
  $("#subjectFormTitle").textContent = "Add Subject";
  $("#saveSubject").textContent = "Save Subject";
}

async function saveSubject(event) {
  event.preventDefault();
  const id = Number($("#subjectId").value || 0);
  const payload = {
    name: $("#subjectName").value.trim(),
    code: $("#subjectCode").value.trim(),
  };
  try {
    await api(
      id ? `/api/admin/subjects/${id}` : "/api/admin/subjects",
      jsonOptions(id ? "PUT" : "POST", payload),
    );
    notify(id ? "Subject updated." : "Subject added.");
    resetSubjectForm();
    await Promise.all([loadSubjects(), loadMeta(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function deleteSubject(id) {
  if (
    !confirm(
      "Delete this subject? It cannot be deleted if results already use it.",
    )
  )
    return;
  try {
    await api(`/api/admin/subjects/${id}`, { method: "DELETE" });
    notify("Subject deleted.");
    await Promise.all([loadSubjects(), loadMeta(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

function calculateGrade(score) {
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

function refreshScoreRow(row) {
  const ca = Math.max(
    0,
    Math.min(40, Number(row.querySelector(".ca").value || 0)),
  );
  const exam = Math.max(
    0,
    Math.min(60, Number(row.querySelector(".exam").value || 0)),
  );
  const total = ca + exam;
  const [letter, remark] = calculateGrade(total);
  row.querySelector(".score-total").textContent = total
    .toFixed(2)
    .replace(/\.00$/, "");
  row.querySelector(".grade-chip").textContent = letter;
  row.querySelector(".remark").textContent = remark;
  refreshResultSummary();
}

function refreshResultSummary() {
  const rows = $$("[data-result-subject]");
  if (!rows.length) return;
  const total = rows.reduce(
    (sum, row) =>
      sum + Number(row.querySelector(".score-total").textContent || 0),
    0,
  );
  const average = rows.length ? total / rows.length : 0;
  $("#resultSummaryTotal").textContent = total.toFixed(2).replace(/\.00$/, "");
  $("#resultSummaryAverage").textContent = `${average.toFixed(2)}%`;
}

async function loadResultSheet() {
  const studentId = Number($("#rStudent").value || 0);
  const sessionId = Number($("#rSession").value || 0);
  const termId = Number($("#rTerm").value || 0);
  if (!studentId || !sessionId || !termId)
    return notify("Select a student, session and term first.", "error");
  if (!META.subjects.length)
    return notify("Add at least one subject before entering results.", "error");

  try {
    const existing = await api(
      `/api/admin/results?student_id=${studentId}&session_id=${sessionId}&term_id=${termId}`,
    );
    const student = STUDENTS.find((s) => Number(s.id) === studentId);
    const offered = student
      ? await api(`/api/admin/student-subjects/${student.id}`)
      : [];
    if (!offered.length)
      return notify(
        "No subjects have been arranged for this student’s class. Set up the Class Subject Arrangement first.",
        "error",
      );
    const map = Object.fromEntries(
      existing.map((row) => [Number(row.subject_id), row]),
    );
    const published = existing.some((row) => Number(row.published) === 1);
    const session = META.sessions.find((s) => Number(s.id) === sessionId);
    const term = META.terms.find((t) => Number(t.id) === termId);

    $("#resultEditorTitle").textContent =
      `${student ? fullName(student) : "Student"} — ${session?.name || ""} ${term?.name || ""}`;
    const badge = $("#publishBadge");
    badge.textContent = published ? "Published" : "Unpublished";
    badge.className = `status-badge ${published ? "published" : "unpublished"}`;

    $("#resultEditor").className = "";
    $("#resultEditor").innerHTML = `
      <div class="table-wrap"><table class="score-table">
        <thead><tr><th>Subject</th><th>CA /40</th><th>Exam /60</th><th>Total /100</th><th>Grade</th><th>Remark</th></tr></thead>
        <tbody>${offered
          .map((subject) => {
            const row = map[Number(subject.id)] || {};
            const ca = row.ca_score ?? 0;
            const exam = row.exam_score ?? 0;
            const total = Number(ca) + Number(exam);
            const [letter, remark] = calculateGrade(total);
            return `<tr data-result-subject="${subject.id}"><td class="subject-name"><strong>${esc(subject.name)}</strong>${subject.code ? `<br><small class="muted">${esc(subject.code)}</small>` : ""}</td><td><input class="ca" type="number" min="0" max="40" step="0.01" value="${esc(ca)}"></td><td><input class="exam" type="number" min="0" max="60" step="0.01" value="${esc(exam)}"></td><td class="score-total">${total.toFixed(2).replace(/\.00$/, "")}</td><td><span class="grade-chip">${letter}</span></td><td class="remark">${remark}</td></tr>`;
          })
          .join("")}</tbody>
      </table></div>
      <div class="result-summary"><span>Total: <strong id="resultSummaryTotal">0</strong></span><span>Average: <strong id="resultSummaryAverage">0%</strong></span><span>Subjects: <strong>${offered.length}</strong></span></div>
      <div class="result-actions"><button id="saveResults" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Results</button><button id="publishResults" class="btn btn-navy"><i class="fa-solid fa-circle-check"></i> Publish</button><button id="unpublishResults" class="btn btn-light"><i class="fa-solid fa-eye-slash"></i> Unpublish</button></div>`;

    $$("#resultEditor .ca, #resultEditor .exam").forEach((input) => {
      input.addEventListener("input", () =>
        refreshScoreRow(input.closest("[data-result-subject]")),
      );
    });
    $("#saveResults").onclick = saveResults;
    $("#publishResults").onclick = () => publishResult(true);
    $("#unpublishResults").onclick = () => publishResult(false);
    refreshResultSummary();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function saveResults() {
  const rows = $$("[data-result-subject]");
  if (!rows.length) return notify("Load a result sheet first.", "error");

  const results = rows.map((row) => ({
    subject_id: Number(row.dataset.resultSubject),
    ca_score: Number(row.querySelector(".ca").value || 0),
    exam_score: Number(row.querySelector(".exam").value || 0),
  }));

  const invalid = results.find(
    (r) =>
      r.ca_score < 0 ||
      r.ca_score > 40 ||
      r.exam_score < 0 ||
      r.exam_score > 60,
  );
  if (invalid) return notify("CA must be 0–40 and Exam must be 0–60.", "error");

  try {
    await api(
      "/api/admin/results",
      jsonOptions("POST", {
        student_id: Number($("#rStudent").value),
        session_id: Number($("#rSession").value),
        term_id: Number($("#rTerm").value),
        results,
      }),
    );
    notify("Results saved successfully.");
    await loadStats();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function publishResult(published) {
  if (!$$("[data-result-subject]").length)
    return notify("Load and save a result sheet first.", "error");
  const word = published ? "publish" : "unpublish";
  if (!confirm(`Are you sure you want to ${word} this result?`)) return;
  try {
    const data = await api(
      "/api/admin/results/publish",
      jsonOptions("POST", {
        student_id: Number($("#rStudent").value),
        session_id: Number($("#rSession").value),
        term_id: Number($("#rTerm").value),
        published,
      }),
    );
    if (!data.changed)
      notify("No saved result records were found to update.", "info");
    else
      notify(`Result ${published ? "published" : "unpublished"} successfully.`);
    await Promise.all([loadStats(), loadResultSheet()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function loadPins() {
  PINS = await api("/api/admin/pins");
  const body = $("#pinRows");
  body.innerHTML = PINS.length
    ? PINS.map(
        (pin) => `
    <tr><td>${esc(pin.student_name)}</td><td>${esc(pin.admission_number)}</td><td>${esc(pin.session_name)}</td><td>${esc(pin.term_name)}</td><td><span class="pin-code">${esc(pin.pin)}</span></td><td>${Number(pin.use_count || 0)}</td><td><span class="status-badge ${Number(pin.active) ? "active" : "inactive"}">${Number(pin.active) ? "Active" : "Inactive"}</span></td><td class="actions-col"><div class="table-actions"><button class="table-btn" data-pin-copy="${esc(pin.pin)}">Copy</button><button class="table-btn" data-pin-status="${pin.id}" data-active="${Number(pin.active) ? 0 : 1}">${Number(pin.active) ? "Disable" : "Enable"}</button><button class="table-btn danger" data-pin-delete="${pin.id}">Delete</button></div></td></tr>`,
      ).join("")
    : '<tr><td colspan="8" class="muted">No PINs generated yet.</td></tr>';
}

async function generatePin() {
  const studentId = Number($("#pStudent").value || 0);
  const sessionId = Number($("#pSession").value || 0);
  const termId = Number($("#pTerm").value || 0);
  if (!studentId || !sessionId || !termId)
    return notify("Select a student, session and term.", "error");

  if (
    !confirm(
      "Generate a new PIN? If one already exists for this period, it will be replaced.",
    )
  )
    return;
  try {
    const data = await api(
      "/api/admin/pins",
      jsonOptions("POST", {
        student_id: studentId,
        session_id: sessionId,
        term_id: termId,
      }),
    );
    $("#newPin").innerHTML =
      `<div class="pin-result"><div><span class="panel-kicker">New result PIN</span><strong>${esc(data.pin)}</strong><p class="muted">Give this PIN privately to the student or parent.</p></div><button class="btn btn-light" id="copyNewPin"><i class="fa-regular fa-copy"></i> Copy PIN</button></div>`;
    $("#copyNewPin").onclick = () => copyText(data.pin);
    notify("Result PIN generated successfully.");
    await Promise.all([loadPins(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    notify("Copied to clipboard.");
  } catch {
    notify(
      "Unable to copy automatically. Please select and copy the PIN.",
      "error",
    );
  }
}

async function setPinStatus(id, active) {
  try {
    await api(
      `/api/admin/pins/${id}/status`,
      jsonOptions("PATCH", { active: Number(active) }),
    );
    notify(Number(active) ? "PIN enabled." : "PIN disabled.");
    await Promise.all([loadPins(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

async function deletePin(id) {
  if (!confirm("Permanently delete this PIN?")) return;
  try {
    await api(`/api/admin/pins/${id}`, { method: "DELETE" });
    notify("PIN deleted.");
    await Promise.all([loadPins(), loadStats()]);
  } catch (error) {
    notify(error.message, "error");
  }
}

function renderSessions(sessions) {
  const body = $("#sessionRows");
  if (!body) return;
  body.innerHTML = sessions.length
    ? sessions
        .map(
          (session) => `
    <tr><td><strong>${esc(session.name)}</strong></td><td><span class="status-badge ${Number(session.active) ? "active" : "inactive"}">${Number(session.active) ? "Active" : "Inactive"}</span></td><td class="actions-col"><button class="table-btn" data-session-status="${session.id}" data-active="${Number(session.active) ? 0 : 1}">${Number(session.active) ? "Deactivate" : "Activate"}</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="3" class="muted">No academic sessions found.</td></tr>';
}

async function addSession(event) {
  event.preventDefault();
  const name = $("#sessionName").value.trim();
  try {
    await api("/api/admin/sessions", jsonOptions("POST", { name }));
    $("#sessionForm").reset();
    notify("Academic session added.");
    await loadMeta();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function setSessionStatus(id, active) {
  try {
    await api(
      `/api/admin/sessions/${id}/status`,
      jsonOptions("PATCH", { active: Number(active) }),
    );
    notify(Number(active) ? "Session activated." : "Session deactivated.");
    await loadMeta();
  } catch (error) {
    notify(error.message, "error");
  }
}

async function changePassword(event) {
  event.preventDefault();
  const current = $("#currentPassword").value;
  const next = $("#newPassword").value;
  const confirmPassword = $("#confirmPassword").value;
  if (next !== confirmPassword)
    return notify("New passwords do not match.", "error");
  if (next.length < 8)
    return notify("New password must be at least 8 characters.", "error");

  try {
    await api(
      "/api/admin/change-password",
      jsonOptions("POST", { current_password: current, new_password: next }),
    );
    event.target.reset();
    notify("Admin password changed successfully.");
  } catch (error) {
    notify(error.message, "error");
  }
}

async function loadTeachers() {
  TEACHERS = await api("/api/admin/teachers");
  const body = $("#teacherRows");
  if (body)
    body.innerHTML = TEACHERS.length
      ? TEACHERS.map(
          (t) =>
            `<tr><td><strong>${esc(t.full_name)}</strong>${t.email ? `<br><small class="muted">${esc(t.email)}</small>` : ""}</td><td>${esc(t.username)}</td><td>${Number(t.assignment_count || 0)}</td><td><span class="status-badge ${Number(t.active) ? "active" : "inactive"}">${Number(t.active) ? "Active" : "Inactive"}</span></td><td class="actions-col"><div class="table-actions"><button class="table-btn" data-teacher-edit="${t.id}"><i class="fa-solid fa-pen"></i> Edit</button>${Number(t.active) ? `<button class="table-btn danger" data-teacher-delete="${t.id}">Deactivate</button>` : `<button class="table-btn" data-teacher-activate="${t.id}">Activate</button>`}</div></td></tr>`,
        ).join("")
      : '<tr><td colspan="5" class="muted">No teachers found.</td></tr>';
  if ($("#assignmentTeacher"))
    $("#assignmentTeacher").innerHTML = optionHtml(
      TEACHERS.filter((t) => Number(t.active)),
      (x) => `${x.full_name} — ${x.username}`,
      true,
      "Select teacher",
    );
}

async function loadAssignments() {
  ASSIGNMENTS = await api("/api/admin/teacher-assignments");
  const body = $("#assignmentRows");
  if (body)
    body.innerHTML = ASSIGNMENTS.length
      ? ASSIGNMENTS.map(
          (a) =>
            `<tr><td>${esc(a.teacher_name)}</td><td>${esc(a.subject_name)}</td><td>${esc(a.class_name)}</td><td>${esc(a.department_name || "—")}</td><td class="actions-col"><button class="table-btn danger" data-assignment-delete="${a.id}">Remove</button></td></tr>`,
        ).join("")
      : '<tr><td colspan="5" class="muted">No teacher assignments yet.</td></tr>';
}

function resetTeacherForm() {
  $("#teacherForm")?.reset();
  $("#teacherId").value = "";
  $("#teacherFormTitle").textContent = "Add Teacher";
  $("#saveTeacher").textContent = "Create Teacher";
  $("#teacherPassword").required = true;
}
function editTeacher(id) {
  const t = TEACHERS.find((x) => Number(x.id) === Number(id));
  if (!t) return;
  $("#teacherId").value = t.id;
  $("#teacherName").value = t.full_name || "";
  $("#teacherUsername").value = t.username || "";
  $("#teacherPassword").value = "";
  $("#teacherEmail").value = t.email || "";
  $("#teacherPhone").value = t.phone || "";
  $("#teacherFormTitle").textContent = "Edit Teacher";
  $("#saveTeacher").textContent = "Update Teacher";
  $("#teacherPassword").required = false;
}
async function saveTeacher(event) {
  event.preventDefault();
  const id = Number($("#teacherId").value || 0);
  const payload = {
    full_name: $("#teacherName").value.trim(),
    username: $("#teacherUsername").value.trim(),
    password: $("#teacherPassword").value,
    email: $("#teacherEmail").value.trim(),
    phone: $("#teacherPhone").value.trim(),
    active: 1,
  };
  try {
    await api(
      id ? `/api/admin/teachers/${id}` : "/api/admin/teachers",
      jsonOptions(id ? "PUT" : "POST", payload),
    );
    notify(id ? "Teacher updated." : "Teacher account created.");
    resetTeacherForm();
    await Promise.all([loadTeachers(), loadAssignments()]);
  } catch (e) {
    notify(e.message, "error");
  }
}
async function toggleTeacher(id, active) {
  try {
    const t = TEACHERS.find((x) => Number(x.id) === Number(id));
    if (!t) return;
    await api(
      `/api/admin/teachers/${id}`,
      jsonOptions("PUT", {
        full_name: t.full_name,
        username: t.username,
        email: t.email || "",
        phone: t.phone || "",
        active: Number(active),
      }),
    );
    notify(Number(active) ? "Teacher activated." : "Teacher deactivated.");
    await loadTeachers();
  } catch (e) {
    notify(e.message, "error");
  }
}
function updateAssignmentDepartmentUI() {
  const c = META.classes.find(
    (x) => Number(x.id) === Number($("#assignmentClass")?.value || 0),
  );
  const isA = /^SS[123]A$/i.test(c?.name || ""),
    isB = /^SS[123]B$/i.test(c?.name || "");
  const f = $("#assignmentDepartmentField"),
    s = $("#assignmentDepartment");
  if (!f || !s) return;
  f.style.display = "";
  s.required = isA || isB;
  s.disabled = isA;
  if (isA) {
    const sci = (META.departments || []).find((d) => d.code === "SCI");
    s.value = sci?.id || "";
  } else if (!isB) s.value = "";
}
async function saveAssignment(event) {
  event.preventDefault();
  try {
    await api(
      "/api/admin/teacher-assignments",
      jsonOptions("POST", {
        teacher_id: Number($("#assignmentTeacher").value),
        subject_id: Number($("#assignmentSubject").value),
        class_id: Number($("#assignmentClass").value),
        department_id: Number($("#assignmentDepartment")?.value || 0) || null,
      }),
    );
    notify("Teacher assignment saved.");
    event.target.reset();
    updateAssignmentDepartmentUI();
    await loadAssignments();
  } catch (e) {
    notify(e.message, "error");
  }
}
async function loadArrangement() {
  const classId = Number($("#arrangementClass").value || 0);

  if (!classId) {
    return notify("Select a class first.", "error");
  }

  const c = META.classes.find((x) => Number(x.id) === classId);

  const isA = /^SS[123]A$/i.test(c?.name || "");
  const isB = /^SS[123]B$/i.test(c?.name || "");

  const deptSelect = $("#arrangementDepartment");
  const deptField = $("#arrangementDepartmentField");

  // Always show department selector
  deptField.style.display = "";

  // Science is automatic for A classes
  if (isA) {
    const sci = (META.departments || []).find(
      (d) => String(d.code || "").toUpperCase() === "SCI",
    );

    if (sci) {
      deptSelect.value = String(sci.id);
    }

    deptSelect.disabled = true;
  } else {
    // B classes and other classes allow manual selection
    deptSelect.disabled = false;
  }

  // IMPORTANT: read the value AFTER setting the department
  const deptId = Number(deptSelect.value || 0);

  if (!deptId) {
    return notify(
      isB ? "Select Art or Commercial for a B class." : "Select a department.",
      "error",
    );
  }

  try {
    const url = `/api/admin/department-subjects/${classId}/${deptId}`;

    ARRANGEMENT = await api(url);

    const department = (META.departments || []).find(
      (d) => Number(d.id) === deptId,
    );

    $("#arrangementTitle").textContent =
      `${c?.name || "Class"} — ${department?.name || "Department"}`;

    $("#arrangementList").innerHTML = ARRANGEMENT.length
      ? ARRANGEMENT.map(
          (s) => `
            <label class="subject-check">
              <input
                type="checkbox"
                value="${s.id}"
                ${Number(s.offered) ? "checked" : ""}
              >
              <span>
                <strong>${esc(s.name)}</strong>
                ${s.code ? `<small>${esc(s.code)}</small>` : ""}
              </span>
            </label>
          `,
        ).join("")
      : `
          <div class="empty-state">
            <h3>No subjects</h3>
            <p>Add subjects first.</p>
          </div>
        `;

    updateArrangementCount();

    $("#saveArrangement").disabled = false;
  } catch (e) {
    notify(e.message, "error");
  }
}

function updateArrangementCount() {
  const n = $$('#arrangementList input[type="checkbox"]:checked').length;

  if ($("#arrangementCount")) {
    $("#arrangementCount").textContent = `${n} selected`;
  }
}
async function saveArrangement() {
  const classId = Number($("#arrangementClass").value || 0);
  if (!classId) return;
  const c = META.classes.find((x) => Number(x.id) === classId);
  const deptId = Number($("#arrangementDepartment").value || 0);
  if (!deptId) return notify("Select a department first.", "error");
  const ids = $$('#arrangementList input[type="checkbox"]:checked').map((x) =>
    Number(x.value),
  );
  try {
    const url = `/api/admin/department-subjects/${classId}/${deptId}`;
    await api(url, jsonOptions("PUT", { subject_ids: ids }));
    notify("Department subject arrangement saved.");
    await Promise.all([loadAssignments(), loadClasses()]);
    await loadArrangement();
  } catch (e) {
    notify(e.message, "error");
  }
}

async function loadBroadsheet() {
  const classId = Number($("#bClass")?.value || 0),
    sessionId = Number($("#bSession")?.value || 0),
    termId = Number($("#bTerm")?.value || 0);
  if (!classId || !sessionId || !termId)
    return notify("Select class, session and term first.", "error");
  const cls = META.classes.find((x) => Number(x.id) === classId),
    isB = /^SS[123]B$/i.test(cls?.name || ""),
    departmentId = Number($("#bDepartment")?.value || 0);
  if (isB && !departmentId)
    return notify(
      "Select Art or Commercial for a B-class broadsheet.",
      "error",
    );
  try {
    const d = await api(
      `/api/admin/broadsheet?class_id=${classId}&department_id=${departmentId}&session_id=${sessionId}&term_id=${termId}`,
    );
    BROADSHEET = d.students || [];
    const subjects = d.subjects || [];
    const deptName = (META.departments || []).find(
      (x) => Number(x.id) === departmentId,
    )?.name;
    $("#broadsheetTitle").textContent =
      `${d.class.name}${deptName ? " — " + deptName : ""} — ${META.sessions.find((x) => Number(x.id) === sessionId)?.name || ""} ${META.terms.find((x) => Number(x.id) === termId)?.name || ""}`;
    $("#broadsheetStatus").textContent =
      `${BROADSHEET.length} students • ${subjects.length} subjects`;
    $("#broadsheetStatus").className = "status-badge active";
    if (!BROADSHEET.length) {
      $("#broadsheetTable").innerHTML =
        '<div class="empty-state"><h3>No active students</h3><p>This class/department has no active students.</p></div>';
      return;
    }
    const enriched = BROADSHEET.map((st) => {
      const valid = st.scores.filter(Boolean),
        total = valid.reduce((a, r) => a + Number(r.total_score || 0), 0),
        avg = valid.length ? total / valid.length : 0;
      return { ...st, total, avg, subjectCount: valid.length };
    }).sort((a, b) => b.avg - a.avg || a.last_name.localeCompare(b.last_name));
    let lastAvg = null,
      lastPos = 0;
    enriched.forEach((st, i) => {
      if (lastAvg === null || Math.abs(st.avg - lastAvg) > 0.0001)
        lastPos = i + 1;
      st.position = lastPos;
      lastAvg = st.avg;
    });
    const head = `<tr><th>Pos.</th><th>Admission</th><th>Student</th><th>Department</th>${subjects.map((x) => `<th>${esc(x.code || x.name)}</th>`).join("")}<th>Total</th><th>Average</th></tr>`;
    const body = enriched
      .map(
        (st) =>
          `<tr><td><strong>${st.position}</strong></td><td><strong>${esc(st.admission_number)}</strong></td><td>${esc(fullName(st))}</td><td>${esc(st.department_name || "—")}</td>${st.scores.map((r) => `<td>${r ? `${Number(r.total_score).toFixed(0)} <small>${esc(r.grade)}</small>` : '<span class="muted">—</span>'}</td>`).join("")}<td><strong>${st.total.toFixed(0)}</strong></td><td><strong>${st.avg.toFixed(1)}%</strong></td></tr>`,
      )
      .join("");
    $("#broadsheetTable").innerHTML =
      `<table class="broadsheet-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  } catch (e) {
    notify(e.message, "error");
  }
}

async function loadSubmissionTracking() {
  const sessionId = Number($("#tSession")?.value || 0),
    termId = Number($("#tTerm")?.value || 0);
  if (!sessionId || !termId)
    return notify("Select session and term first.", "error");
  try {
    SUBMISSIONS = await api(
      `/api/admin/submission-tracking?session_id=${sessionId}&term_id=${termId}`,
    );
    const body = $("#submissionRows");
    if (!SUBMISSIONS.length) {
      body.innerHTML =
        '<tr><td colspan="9" class="muted">No active teacher assignments found.</td></tr>';
      return;
    }
    const cls = (x) =>
      x === "PUBLISHED"
        ? "published"
        : x === "SUBMITTED"
          ? "active"
          : x === "IN PROGRESS"
            ? "unpublished"
            : "neutral";
    body.innerHTML = SUBMISSIONS.map(
      (r) =>
        `<tr><td><strong>${esc(r.teacher_name)}</strong><br><small class="muted">${esc(r.username)}</small></td><td>${esc(r.subject_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.department_name || "—")}</td><td>${Number(r.student_count)}</td><td>${Number(r.entered_count)}/${Number(r.student_count)}</td><td>${Number(r.submitted_count)}/${Number(r.student_count)}</td><td>${Number(r.published_count)}/${Number(r.student_count)}</td><td><span class="status-badge ${cls(r.status)}">${esc(r.status)}</span></td></tr>`,
    ).join("");
  } catch (e) {
    notify(e.message, "error");
  }
}

function bindEvents() {
  // Dashboard/sidebar navigation
  $$("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view);
    });
  });

  $$("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.jump);
    });
  });

  // Mobile menu
  if ($("#menuBtn")) {
    $("#menuBtn").onclick = () => {
      $("#sidebar")?.classList.add("open");
      $("#sidebarOverlay")?.classList.add("show");
    };
  }

  if ($("#sidebarClose")) {
    $("#sidebarClose").onclick = closeSidebar;
  }

  if ($("#sidebarOverlay")) {
    $("#sidebarOverlay").onclick = closeSidebar;
  }

  // Logout
  if ($("#logout")) {
    $("#logout").onclick = async () => {
      await fetch("/api/admin/logout", { method: "POST" });
      location.href = "login.html";
    };
  }

  // Students
  if ($("#studentForm")) {
    $("#studentForm").onsubmit = saveStudent;
  }

  if ($("#sClass")) {
    $("#sClass").addEventListener("change", updateStudentDepartmentUI);
  }

  if ($("#assignmentClass")) {
    $("#assignmentClass").addEventListener(
      "change",
      updateAssignmentDepartmentUI,
    );
  }

  if ($("#resetStudentForm")) {
    $("#resetStudentForm").onclick = resetStudentForm;
  }

  if ($("#cancelStudentEdit")) {
    $("#cancelStudentEdit").onclick = resetStudentForm;
  }

  if ($("#openStudentForm")) {
    $("#openStudentForm").onclick = () => {
      resetStudentForm();
      $("#studentFormPanel")?.scrollIntoView({ behavior: "smooth" });
    };
  }

  if ($("#searchStudents")) {
    $("#searchStudents").onclick = () => {
      loadStudents($("#studentSearch")?.value || "").catch((e) =>
        notify(e.message, "error"),
      );
    };
  }

  if ($("#studentSearch")) {
    $("#studentSearch").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        loadStudents(event.target.value).catch((e) =>
          notify(e.message, "error"),
        );
      }
    });
  }

  if ($("#studentDepartmentFilter")) {
    $("#studentDepartmentFilter").addEventListener("change", () =>
      renderStudents(),
    );
  }

  if ($("#studentRows")) {
    $("#studentRows").onclick = (event) => {
      const edit = event.target.closest("[data-student-edit]");
      const status = event.target.closest("[data-student-status]");

      if (edit) {
        editStudent(edit.dataset.studentEdit);
      }

      if (status) {
        setStudentStatus(status.dataset.studentStatus, status.dataset.active);
      }
    };
  }

  // Classes
  if ($("#classForm")) {
    $("#classForm").onsubmit = saveClass;
  }

  if ($("#cancelClassEdit")) {
    $("#cancelClassEdit").onclick = resetClassForm;
  }

  if ($("#refreshClasses")) {
    $("#refreshClasses").onclick = () => {
      loadClasses().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#classRows")) {
    $("#classRows").onclick = (event) => {
      const edit = event.target.closest("[data-class-edit]");
      const del = event.target.closest("[data-class-delete]");

      if (edit) {
        const item = CLASSES.find(
          (x) => Number(x.id) === Number(edit.dataset.classEdit),
        );

        if (item) {
          $("#classId").value = item.id;
          $("#className").value = item.name;
          $("#classFormTitle").textContent = "Edit Class";
          $("#saveClass").textContent = "Update Class";
        }
      }

      if (del) {
        deleteClass(del.dataset.classDelete);
      }
    };
  }

  // Subjects
  if ($("#subjectForm")) {
    $("#subjectForm").onsubmit = saveSubject;
  }

  if ($("#cancelSubjectEdit")) {
    $("#cancelSubjectEdit").onclick = resetSubjectForm;
  }

  if ($("#refreshSubjects")) {
    $("#refreshSubjects").onclick = () => {
      loadSubjects().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#subjectRows")) {
    $("#subjectRows").onclick = (event) => {
      const edit = event.target.closest("[data-subject-edit]");
      const del = event.target.closest("[data-subject-delete]");

      if (edit) {
        const item = SUBJECTS.find(
          (x) => Number(x.id) === Number(edit.dataset.subjectEdit),
        );

        if (item) {
          $("#subjectId").value = item.id;
          $("#subjectName").value = item.name;
          $("#subjectCode").value = item.code || "";
          $("#subjectFormTitle").textContent = "Edit Subject";
          $("#saveSubject").textContent = "Update Subject";
        }
      }

      if (del) {
        deleteSubject(del.dataset.subjectDelete);
      }
    };
  }

  // Class Subjects / Department Subject Allocation
  if ($("#arrangementClass")) {
    $("#arrangementClass").addEventListener("change", async () => {
      const c = META.classes.find(
        (x) => Number(x.id) === Number($("#arrangementClass").value || 0),
      );

      const isA = /^SS[123]A$/i.test(c?.name || "");
      const isB = /^SS[123]B$/i.test(c?.name || "");

      const s = $("#arrangementDepartment");

      if (!s) return;

      $("#arrangementDepartmentField").style.display = "";

      if (isA) {
        const sci = (META.departments || []).find(
          (d) => String(d.code || "").toUpperCase() === "SCI",
        );

        s.disabled = true;
        s.value = sci ? String(sci.id) : "";

        if (sci) {
          await loadArrangement();
        }
      } else if (isB) {
        s.disabled = false;
        s.value = "";

        $("#arrangementTitle").textContent = "Select Art or Commercial";

        $("#saveArrangement").disabled = true;

        $("#arrangementList").innerHTML =
          '<div class="empty-state"><h3>Select a department</h3><p>Choose Art or Commercial, then click Load Subjects.</p></div>';
      } else {
        s.disabled = false;
        s.value = "";
      }
    });
  }

  if ($("#arrangementDepartment")) {
    $("#arrangementDepartment").addEventListener("change", async () => {
      const classId = Number($("#arrangementClass")?.value || 0);

      const deptId = Number($("#arrangementDepartment")?.value || 0);

      if (classId && deptId) {
        await loadArrangement();
      }
    });
  }

  if ($("#loadArrangement")) {
    $("#loadArrangement").onclick = () => {
      loadArrangement().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#saveArrangement")) {
    $("#saveArrangement").onclick = () => {
      saveArrangement().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#arrangementList")) {
    $("#arrangementList").addEventListener("change", updateArrangementCount);
  }

  // Result entry
  if ($("#loadResult")) {
    $("#loadResult").onclick = () => {
      loadResultSheet().catch((e) => notify(e.message, "error"));
    };
  }

  // Broadsheet
  if ($("#loadBroadsheet")) {
    $("#loadBroadsheet").onclick = () => {
      loadBroadsheet().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#bClass")) {
    $("#bClass").addEventListener("change", () => {
      const c = META.classes.find(
        (x) => Number(x.id) === Number($("#bClass").value || 0),
      );

      const isA = /^SS[123]A$/i.test(c?.name || "");
      const isB = /^SS[123]B$/i.test(c?.name || "");

      const sel = $("#bDepartment");

      if (!sel) return;

      if (isA) {
        const sci = (META.departments || []).find(
          (d) => String(d.code || "").toUpperCase() === "SCI",
        );

        sel.innerHTML = sci
          ? `<option value="${sci.id}">Science</option>`
          : '<option value="">Science</option>';

        sel.value = sci ? String(sci.id) : "";
        sel.disabled = true;
      } else if (isB) {
        sel.innerHTML =
          '<option value="">Select department</option>' +
          (META.departments || [])
            .filter((d) =>
              ["ART", "COM"].includes(String(d.code || "").toUpperCase()),
            )
            .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)
            .join("");

        sel.value = "";
        sel.disabled = false;
      } else {
        sel.innerHTML = '<option value="">Not applicable</option>';

        sel.value = "";
        sel.disabled = true;
      }
    });
  }

  // Teacher submissions
  if ($("#loadSubmissions")) {
    $("#loadSubmissions").onclick = () => {
      loadSubmissionTracking().catch((e) => notify(e.message, "error"));
    };
  }

  // PINs
  if ($("#generatePin")) {
    $("#generatePin").onclick = () => {
      generatePin().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#refreshPins")) {
    $("#refreshPins").onclick = () => {
      loadPins().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#pinRows")) {
    $("#pinRows").onclick = (event) => {
      const copy = event.target.closest("[data-pin-copy]");
      const status = event.target.closest("[data-pin-status]");
      const del = event.target.closest("[data-pin-delete]");

      if (copy) copyText(copy.dataset.pinCopy);

      if (status) {
        setPinStatus(status.dataset.pinStatus, status.dataset.active);
      }

      if (del) {
        deletePin(del.dataset.pinDelete);
      }
    };
  }

  // Sessions / Settings
  if ($("#sessionForm")) {
    $("#sessionForm").onsubmit = addSession;
  }

  if ($("#sessionRows")) {
    $("#sessionRows").onclick = (event) => {
      const status = event.target.closest("[data-session-status]");

      if (status) {
        setSessionStatus(status.dataset.sessionStatus, status.dataset.active);
      }
    };
  }

  if ($("#passwordForm")) {
    $("#passwordForm").onsubmit = changePassword;
  }

  // Teachers
  if ($("#teacherForm")) {
    $("#teacherForm").onsubmit = saveTeacher;
  }

  if ($("#cancelTeacherEdit")) {
    $("#cancelTeacherEdit").onclick = resetTeacherForm;
  }

  if ($("#refreshTeachers")) {
    $("#refreshTeachers").onclick = () => {
      loadTeachers().catch((e) => notify(e.message, "error"));
    };
  }

  if ($("#teacherRows")) {
    $("#teacherRows").onclick = (event) => {
      const edit = event.target.closest("[data-teacher-edit]");
      const del = event.target.closest("[data-teacher-delete]");
      const act = event.target.closest("[data-teacher-activate]");

      if (edit) editTeacher(edit.dataset.teacherEdit);

      if (del) toggleTeacher(del.dataset.teacherDelete, 0);

      if (act) toggleTeacher(act.dataset.teacherActivate, 1);
    };
  }

  // Teacher assignments
  if ($("#assignmentForm")) {
    $("#assignmentForm").onsubmit = saveAssignment;
  }

  if ($("#assignmentRows")) {
    $("#assignmentRows").onclick = (event) => {
      const del = event.target.closest("[data-assignment-delete]");

      if (del) {
        api(`/api/admin/teacher-assignments/${del.dataset.assignmentDelete}`, {
          method: "DELETE",
        })
          .then(() => {
            notify("Assignment removed.");
            loadAssignments();
          })
          .catch((e) => notify(e.message, "error"));
      }
    };
  }
}

async function init() {
  bindEvents();
  const me = await api("/api/admin/me");
  const name = me.admin.name || me.admin.username || "Administrator";
  $("#adminName").textContent = `Signed in as ${name}`;
  $("#sidebarAdmin").textContent = name;

  await Promise.all([
    loadMeta(),
    loadStats(),
    loadClasses(),
    loadSubjects(),
    loadPins(),
    loadTeachers(),
  ]);
  await loadStudents();
  await loadMeta();
  updateStudentDepartmentUI();
  await loadAssignments();
}

init().catch((error) => notify(error.message, "error"));
