# Korecome Result System — Rebuilt

This build is focused on the result workflow. The public root page is the Result Checker.

## Included workflow

- Students with class and department
- Science / Art / Commercial department structure
- SS1A, SS2A, SS3A automatically use Science
- SS1B, SS2B, SS3B require Art or Commercial per student
- Class / department subject allocation
- Teacher accounts and department-aware teaching assignments
- Teacher score entry (CA /40, Exam /60)
- Teacher submission tracker: Not Started, In Progress, Submitted, Published
- Admin result entry and publishing
- Class / department broadsheet with totals, averages and positions
- Result PIN generation and secure public result checking
- Published result shows the student's department

## Run locally

Open this folder in VS Code, then run:

```powershell
npm install
npm start
```

Open:

- Result Checker: http://localhost:3000
- Admin: http://localhost:3000/admin/
- Teacher Portal: http://localhost:3000/teacher/

The existing `.env` from the supplied project is included so the local MySQL settings are preserved.

## Recommended setup order

1. Confirm classes and departments.
2. Add subjects.
3. Open **Class Subjects** and assign subjects to each class / department.
4. Add students and select the correct department for B classes.
5. Add teachers.
6. Assign each teacher to subject + class + department where applicable.
7. Teachers enter and submit scores.
8. Admin checks **Teacher Submissions**.
9. Admin checks the **Class Broadsheet**.
10. Publish results and generate result PINs.
11. Students check results from the public Result Checker.

## Important department behavior

- A classes: Science is automatic.
- B classes: Art or Commercial must be selected.
- Teacher assignments for B classes require the department.
- Teacher student lists are filtered to that department.
- Submission tracking counts only students in the teacher's assigned department.
- B-class broadsheets require Art or Commercial before loading.
