export type McpTool = {
	readonly name: string;
	readonly procedure: string;
	readonly description: string;
};

export const MCP_TOOLS: readonly McpTool[] = [
	{
		name: "sales_create_request",
		procedure: "sales.createRequest",
		description:
			"Queue a sales extraction for one explicit contact. The profile picks who processes it: qwen-local-experimental/sales-qwen-v1 is processed by you through sales_store_proposal, crm-ollama/sales-qwen-v1 by the CRM on its Ollama service, crm-codex/sales-codex-v1 by the CRM on the Codex connection of the key's owner. A human approves every proposal. Requires sales proposal write permission.",
	},
	{
		name: "sales_get_request",
		procedure: "sales.getRequest",
		description: "Read a sales extraction request and its proposal.",
	},
	{
		name: "sales_pending_requests",
		procedure: "sales.pendingRequests",
		description:
			"Read pending sales extraction requests. Requires explicit CRM read or sales read permission.",
	},
	{
		name: "sales_store_proposal",
		procedure: "sales.storeProposal",
		description:
			"Store source-backed sales operations for a pending request without applying them. Every value must be an exact quotation of the request's source. State which model or agent produced them in producedBy. Requires sales proposal write permission.",
	},
	{
		name: "sales_fail_request",
		procedure: "sales.failRequest",
		description:
			"Mark a pending sales request as failed when no source-backed operation can be extracted. Changes no CRM record. Requires sales proposal write permission.",
	},

	{
		name: "search_crm",
		procedure: "search.quick",
		description:
			"Find active records only, with at most 5 per kind. Companies match name or domain; contacts match name or email; deals match name. Matches contain the text. Returns each hit's kind and id.",
	},
	{
		name: "resolve_customer",
		procedure: "search.resolveCustomer",
		description:
			"Look up exactly one email or domain. Use search_crm for names and get_contact or get_company for ids. Email equality is literal and case-insensitive, without plus-tag or dot stripping or company inference. Strict email validation returns invalid for nonstandard stored values such as ana@localhost; use get_contact with the literal id. matchType compares the stored email with the original input spelling. Domains use existing URL/domain normalization and exact stored-domain equality. Returns resolved, ambiguous, not_found or invalid, at most 25 matches, and truncated. Active records only by default. archived true selects archived records only, without hidden-archive hints.",
	},
	{
		name: "whoami",
		procedure: "users.me",
		description: "The signed-in user behind this API key.",
	},
	{
		name: "list_users",
		procedure: "users.list",
		description:
			"Every user of the workspace, with the ids that owner fields accept.",
	},
	{
		name: "get_workspace",
		procedure: "workspace.get",
		description: "The workspace: its name, website and onboarding state.",
	},
	{
		name: "dashboard_summary",
		procedure: "dashboard.summary",
		description:
			"Pipeline totals, the weighted forecast, open deals by stage and recent activity, for the caller or for everyone.",
	},
	{
		name: "list_contacts",
		procedure: "contacts.list",
		description:
			"Page through contacts with search, sort, pagination and facet filters. Archived records are excluded unless archived is true, which returns archived records only. The lastActivity sort and activity filter use lastActivityAt. This timestamp records when an activity is logged, not when it occurred. Agent-written activities such as company research also move it. Returns rows, the total and facet counts.",
	},
	{
		name: "get_contact",
		procedure: "contacts.byId",
		description:
			"A contact in full: fields, brief, facts with evidence, relationship history and deals.",
	},
	{
		name: "create_contact",
		procedure: "contacts.create",
		description:
			"Create a contact. Only firstName is required; companyId and ownerId take ids from other tools.",
	},
	{
		name: "update_contact",
		procedure: "contacts.update",
		description:
			"Change one or more fields of a contact. Pass the contact id and only the fields to change under data.",
	},
	{
		name: "enrich_contact",
		procedure: "contacts.enrich",
		description:
			"Queue the research agent for a contact. Research runs in the background and can spend credits.",
	},
	{
		name: "list_companies",
		procedure: "companies.list",
		description:
			"Page through companies with search, sort, pagination and facet filters. Archived records are excluded unless archived is true, which returns archived records only. The lastActivity sort and activity filter use lastActivityAt. This timestamp records when an activity is logged, not when it occurred. Agent-written activities such as company research also move it. Returns rows, the total and facet counts.",
	},
	{
		name: "get_company",
		procedure: "companies.byId",
		description:
			"A company in full: profile, contacts, deals, custom fields and enrichment state.",
	},
	{
		name: "create_company",
		procedure: "companies.create",
		description:
			"Create a company. Only name is required; give a domain so the agent can research it.",
	},
	{
		name: "update_company",
		procedure: "companies.update",
		description:
			"Change one or more fields of a company. Pass the company id and only the fields to change under data.",
	},
	{
		name: "enrich_company",
		procedure: "companies.enrich",
		description:
			"Queue the research agent for a company. Research runs in the background and can spend credits.",
	},
	{
		name: "list_deals",
		procedure: "deals.list",
		description:
			"Page through deals with search, sort, pagination and facet filters. Archived records are excluded unless archived is true, which returns archived records only. The lastActivity sort uses lastActivityAt. This timestamp records when an activity is logged, not when it occurred. Agent-written activities such as company research also move it. Amounts are in cents; the open value is in the reporting currency.",
	},
	{
		name: "get_deal",
		procedure: "deals.byId",
		description:
			"A deal in full: stage, amounts, exchange rate, custom fields and the people on it.",
	},
	{
		name: "create_deal",
		procedure: "deals.create",
		description:
			"Create a deal. It needs a name, a companyId and an ownerId; amountCents is an integer in the deal's currency.",
	},
	{
		name: "update_deal",
		procedure: "deals.update",
		description:
			"Change one or more fields of a deal. Pass the deal id and only the fields to change under data.",
	},
	{
		name: "set_deal_stage",
		procedure: "deals.setStage",
		description:
			"Move a deal to another stage. Closing stages take an optional closedReason.",
	},
	{
		name: "attach_contact_to_deal",
		procedure: "deals.attachContact",
		description:
			"Put a contact on a deal with an optional role. The contact must work at the deal's company.",
	},
	{
		name: "timeline",
		procedure: "activities.timeline",
		description:
			"Read an activity timeline. Pass one id. dealId wins over contactId, which wins over companyId. Only activities stored with the selected id are returned. Returns a cursor for the next page.",
	},
	{
		name: "my_tasks",
		procedure: "activities.myTasks",
		description:
			"Open tasks the caller created. No assignee exists. Overdue means dueAt is before now, compared as instants. Tasks on archived records are included.",
	},
	{
		name: "follow_ups",
		procedure: "activities.followUps",
		description:
			"Read open tasks the caller created. timeZone (IANA name) and days (1–31) are required. Categories compare stored instants: overdue is before asOf; due_today is the remaining local day, from asOf to tomorrowStart; next_days ends before windowEnd; later starts at windowEnd; undated has no dueAt. A UI task saved for a calendar day is stored as local midnight and becomes overdue once that instant passes. Tasks on archived linked records are excluded. Counts cover all pages from one read-only snapshot per request. asOf defaults to server now and is echoed back. Supported asOf instants have UTC years 0002–9998. Unsupported instants or invalid day boundaries return BAD_REQUEST. Reuse nextCursor with the same timeZone, days and asOf; omitted asOf reuses the cursor instant. The cursor binds the caller. Later pages use current records, not a historical snapshot.",
	},
	{
		name: "log_activity",
		procedure: "activities.create",
		description:
			"Log a note, call, email, meeting or task on a company, contact or deal. A task needs a subject and takes a dueAt.",
	},
	{
		name: "complete_task",
		procedure: "activities.complete",
		description: "Mark a task done, or reopen it with completed set to false.",
	},
	{
		name: "intake_submit",
		procedure: "intake.submit",
		description:
			"File a lead. Pass an email and, if known, a name, company name or domain, a message and a short source label such as website-form. Finds the contact by email or creates it, logs the message as a note and queues research in the background. Returns the contact id and whether it was created, or status suppressed for an address a rep deleted. This is the only tool a key with the intake profile can call.",
	},
	{
		name: "list_fields",
		procedure: "fields.list",
		description:
			"The custom field definitions of an entity (COMPANY, CONTACT or DEAL), with the keys that update tools accept under data.fields.",
	},
	{
		name: "export_csv",
		procedure: "csv.export",
		description:
			"Export every active (not archived) record of one entity as CSV text. entity is companies, contacts or deals. Custom fields are extra field:<key> columns. Deal amounts are in major units, such as 1234.50, beside a currency column. Cells that start with = + - @ get a leading single quote. Returns csv, rows and truncated, which is true when the row cap cut the export short.",
	},
];
