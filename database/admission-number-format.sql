-- Korecome admission-number migration
-- Required format: KCC00001, KCC00002, KCC00003 ...
-- The application performs this migration automatically on startup.

USE korecome_results;

SELECT id, admission_number, first_name, last_name
FROM students
ORDER BY id;
