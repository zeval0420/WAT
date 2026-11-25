New functionalities:

ALL:
Calendar - Quick select of week or month

STUDENT:
Prompt Student to select their Core and Elective, or simply display ALL

TEACHER:
When selecting elective subjects allow option to show to both Grade 11 and Grade 12, default to both, since they have shared elective subjects.
Core Subjects may also appear in elective list, add toggle to set deadline for both or only for one, when it is selected.
Show a quick view summary tab of all the assessments created/added by the respective teacher.
Options in the Add Assessment, change Synchronous to "In Class" and Asynchronous to "Submission".
Add Assessment type options: ["Formative Assessment", "Alternative Assessment", "Summative Assessment", "Long Test", "Defense"]
Add Option to indicate High Stakes vs Low Stakes, Formative Assessments default to Low Stakes and the Others default to High Stakes, make this changeable though. 
Show the number of High and Low stakes per day in the week when adding, show also what others have placed in the week, but lock them (Don't make them editable by anyone not who placed them)

BATCH ADVISER:
She chooses to publish selected weeks to be viewable per student, different batch advisers for different batches.
Also, changes in the schedule when it is already published goes through her first. She has to approve it before the change is reflected in the student side. Email her a notification for any changes done by subject teachers to published weeks.
Allow her also to change the maximum recommended number of high and low stake assessments per day, separately tracked.
Upon publishing a week, email the respective students the selected Week of WAT. Create a file where I can place email credentials, use PHPMailer.

ROOT ADMIN:
Has all privileges of Batch Adviser.
Has ability to set the batch adviser for each batch. Do this by having a new table named wat_batch_advisers.
Can edit the email notification sent.


For any SQL queries to run, give me the raw queries to run in prod.
