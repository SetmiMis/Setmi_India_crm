# User guide — SETMI INDIA CRM

## Signing in

Use your **username or email** and password. If you set up an authenticator app you will also be
asked for a 6-digit code. Forgot your password → "Forgot password?" sends a reset link to your email.
Change your password, theme (light/dark) and authenticator under **My Settings**.

## Daily routine (sales rep)

1. **Follow-ups** — start with *Overdue*, then *Due today*. Each card has Call, WhatsApp and
   *Log call*.
2. **Available Leads** — call new unassigned customers, choose Hot/Warm/Cold, press **Claim**. You are
   taken to the enquiry to log the call.
3. **Log a call** on the enquiry: status, interest (if connected), remarks. The next follow-up date is
   set automatically (Hot = next working day, Warm = 2, Cold = 6; Sundays/holidays skipped) unless you
   choose a date. The first call moves a New/Quoted lead to Follow-up.
4. **Move stage** when something happens: Quoted (quote no. + amount), Won (invoice no. + order
   value), Lost (reason), Dispatched (courier details, weight), Closed (feedback rating).
5. **Record order in OMS** (if configured) marks the enquiry Won and lets you download the PI, mark it
   sent and record payments.

## New leads

* **New Enquiry**: type the phone first — known customers fill in automatically and you are warned
  about repeat enquiries. Pincode fills district/state. Qty + timeline give a Grade (A/B/C). Attach a
  PDF if you have one. It goes to **Pending Approvals**.
* **Bulk Import**: upload CSV/Excel, match the columns, check the preview, import → Pending Approvals.
* **Public form** (`/enquiry`): share this link with customers or at exhibitions.

## Admins

* **Pending Approvals**: Approve (optionally assign to someone; otherwise it appears on Available
  Leads) or Reject with a reason. Fix wrong fields first with *Correct fields*.
* **Reports**, **Team Performance**: by source and by person; download CSV.
* **Users & Team**: create logins, change roles, deactivate leavers (they lose access at once), reset
  passwords, manage the Lead By roster.
* **Admin Settings**: holidays, Meta import destination, digest recipients, share links, website
  metrics key, archive, job status, audit trail.

## Hand-overs

To give a lead to a colleague use **Transfer** on the enquiry; it moves when they accept it on their
Pipeline page. Admins can reassign directly in *Edit enquiry*.

## Insights

* **MAP Analytics**: enquiries by place and zone (Zone in = converted, Zone out = lost).
* **Data Analysis**: filter by product/state/source/stage/month and break down instantly. *Won
  customers (CSV)* downloads converted customers.
* **Dashboard**: KPIs, the Contacted → Approved → Converted funnel, today's calls and charts; every
  number links to the matching list.

## Troubleshooting

| Message | Meaning |
|---|---|
| "This enquiry was changed by someone else — reload" | someone saved first; reload and redo your change |
| "Already claimed by …" | a colleague claimed it a moment earlier |
| "You can only do this on your own leads" | the lead belongs to someone else |
| "Sign-in is temporarily unavailable" | the database cannot be reached; try again shortly |
