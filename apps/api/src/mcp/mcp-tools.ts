export type McpTool = {
	readonly name: string;
	readonly procedure: string;
	readonly description: string;
};

export const MCP_TOOLS: readonly McpTool[] = [
	{
		name: "search_crm",
		procedure: "search.quick",
		description:
			"Find companies, contacts and deals whose name, email or domain contains the text. Returns each hit's kind and id, which the other tools take as input.",
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
			"Pipeline totals, open deals by stage and recent activity, for the caller or for everyone.",
	},
	{
		name: "list_contacts",
		procedure: "contacts.list",
		description:
			"Page through contacts with search, sort, pagination and facet filters. Returns rows, the total and facet counts.",
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
			"Page through companies with search, sort, pagination and facet filters. Returns rows, the total and facet counts.",
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
			"Page through deals with search, sort, pagination and facet filters. Amounts are in cents; the open value is in the reporting currency.",
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
			"The activity timeline of a company, contact or deal: notes, calls, emails, meetings, tasks and stage changes, newest first, with a cursor for the next page.",
	},
	{
		name: "my_tasks",
		procedure: "activities.myTasks",
		description: "Open tasks assigned to the caller, overdue or upcoming.",
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
		name: "list_fields",
		procedure: "fields.list",
		description:
			"The custom field definitions of an entity (COMPANY, CONTACT or DEAL), with the keys that update tools accept under data.fields.",
	},
];
