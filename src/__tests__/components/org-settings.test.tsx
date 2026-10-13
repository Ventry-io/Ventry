import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import OrgSettings from "@/components/admin/organization/OrgSettings";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_ID = "admin-1";
const ORG_ID = "org-1";

type FetchHandler = {
  url: string;
  method?: string;
  response: unknown;
  status?: number;
};

function setupFetch(handlers: FetchHandler[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, options?: RequestInit) => {
    const path = new URL(url, "http://localhost").pathname;
    const method = ((options?.method ?? "GET") as string).toUpperCase();
    const handler = handlers.find(
      (h) => h.url === path && (h.method?.toUpperCase() ?? "GET") === method,
    );
    const data = handler?.response ?? { error: "Unhandled fetch" };
    const status = handler?.status ?? (handler ? 200 : 500);
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const mockProfile = {
  admin: {
    id: ADMIN_ID,
    user: { id: "user-1", name: "Owner User", email: "owner@example.com", image: null },
  },
};

const mockOrg = {
  id: ORG_ID,
  name: "Test Org",
  slug: "test-org",
  description: "A test org",
  logoUrl: null,
  ownerId: ADMIN_ID,
  createdAt: "2026-01-01T00:00:00.000Z",
  _count: { members: 2, events: 0 },
};

const mockOrgWithEvents = { ...mockOrg, _count: { members: 2, events: 3 } };

const mockMembers = [
  {
    adminId: ADMIN_ID,
    permissions: [],
    accessLevel: "WRITE",
    departmentId: null,
    role: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
    admin: {
      id: ADMIN_ID,
      user: { id: "user-1", name: "Owner User", email: "owner@example.com", image: null },
    },
  },
  {
    adminId: "admin-2",
    permissions: ["COMMUNITY", "SUPPORT_TICKETS"],
    accessLevel: "WRITE",
    departmentId: null,
    role: null,
    joinedAt: "2026-01-15T00:00:00.000Z",
    admin: {
      id: "admin-2",
      user: { id: "user-2", name: "Member User", email: "member@example.com", image: null },
    },
  },
];

const mockInvitations = [
  {
    id: "inv-1",
    invitedEmail: "invited@example.com",
    permissions: ["COMMUNITY"],
    status: "PENDING",
    expiresAt: "2099-07-10T00:00:00.000Z",
    createdAt: "2026-06-30T00:00:00.000Z",
    invitedByAdmin: { user: { id: "user-1", name: "Owner User" } },
  },
];

function orgHandlers(org = mockOrg) {
  return [
    { url: `/api/admin/organizations/${ORG_ID}/crew`, response: { departments: [], crewResources: [], canWrite: true } },
    { url: "/api/admin/profile", response: mockProfile },
    { url: "/api/admin/organizations", response: { organizations: [org] } },
    { url: `/api/admin/organizations/${ORG_ID}/members`, response: { members: mockMembers } },
    { url: `/api/admin/organizations/${ORG_ID}/invitations`, response: { invitations: mockInvitations } },
  ];
}

function noOrgHandlers() {
  return [
    { url: "/api/admin/profile", response: mockProfile },
    { url: "/api/admin/organizations", response: { organizations: [] } },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Loading ──────────────────────────────────────────────────────────────────

describe("OrgSettings — loading", () => {
  it("shows spinner while fetching", () => {
    setupFetch(noOrgHandlers());
    render(<OrgSettings />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

// ─── No org ───────────────────────────────────────────────────────────────────

describe("OrgSettings — no org", () => {
  beforeEach(() => setupFetch(noOrgHandlers()));

  it("shows create org form after load", async () => {
    render(<OrgSettings />);
    await waitFor(() =>
      expect(screen.getByText("Create your organization")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /create organization/i })).toBeInTheDocument();
  });

  it("auto-generates slug from org name", async () => {
    render(<OrgSettings />);
    await waitFor(() => screen.getByText("Create your organization"));

    fireEvent.change(screen.getByRole("textbox", { name: /organization name/i }), {
      target: { value: "My Cool Org" },
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: /url slug/i })).toHaveValue("my-cool-org");
    });
  });

  it("stops auto-generating slug after manual slug edit", async () => {
    render(<OrgSettings />);
    await waitFor(() => screen.getByText("Create your organization"));

    const slugInput = screen.getByRole("textbox", { name: /url slug/i });
    fireEvent.change(slugInput, { target: { value: "my-custom-slug" } });

    fireEvent.change(screen.getByRole("textbox", { name: /organization name/i }), {
      target: { value: "Different Name Entirely" },
    });

    await waitFor(() => {
      expect(slugInput).toHaveValue("my-custom-slug");
    });
  });

  it("submits POST /api/admin/organizations on create", async () => {
    const mock = setupFetch([
      ...noOrgHandlers(),
      { url: "/api/admin/organizations", method: "POST", response: { organization: mockOrg }, status: 201 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getByText("Create your organization"));

    fireEvent.change(screen.getByRole("textbox", { name: /organization name/i }), {
      target: { value: "Test Org" },
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /url slug/i })).toHaveValue("test-org"),
    );

    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => {
      const postCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes("/api/admin/organizations") &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as [string, RequestInit])[1].body as string) as {
        name: string;
        slug: string;
      };
      expect(body.name).toBe("Test Org");
      expect(body.slug).toBe("test-org");
    });
  });

  it("shows server error on 409", async () => {
    setupFetch([
      ...noOrgHandlers(),
      { url: "/api/admin/organizations", method: "POST", response: { error: "Organization slug already taken" }, status: 409 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getByText("Create your organization"));

    fireEvent.change(screen.getByRole("textbox", { name: /organization name/i }), {
      target: { value: "Test Org" },
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /url slug/i })).toHaveValue("test-org"),
    );

    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() =>
      expect(screen.getByText("Organization slug already taken")).toBeInTheDocument(),
    );
  });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

describe("OrgSettings — org dashboard", () => {
  beforeEach(() => setupFetch(orgHandlers()));

  it("shows org name, slug, and tabs after load", async () => {
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));

    expect(screen.getByText((text) => text.includes(`${window.location.origin}/org/test-org`))).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /details/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /members/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /invitations/i })).toBeInTheDocument();
  });

  it("details tab shows org info", async () => {
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("A test org")).toBeInTheDocument();
    expect(screen.getByText(`${window.location.origin}/org/test-org`)).toBeInTheDocument();
  });
});

// ─── Details tab — owner ──────────────────────────────────────────────────────

describe("OrgDetailsTab — owner", () => {
  it("shows edit button for owner", async () => {
    setupFetch(orgHandlers());
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("edit form appears and PATCH is called on save", async () => {
    const mock = setupFetch([
      ...orgHandlers(),
      {
        url: `/api/admin/organizations/${ORG_ID}`,
        method: "PATCH",
        response: { organization: { ...mockOrg, name: "Updated Org" } },
      },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    await waitFor(() => screen.getByDisplayValue("Test Org"));
    fireEvent.change(screen.getByDisplayValue("Test Org"), {
      target: { value: "Updated Org" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes(`/api/admin/organizations/${ORG_ID}`) &&
          (opts as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
    });
  });

  it("cancel edit restores original values", async () => {
    setupFetch(orgHandlers());
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() => screen.getByDisplayValue("Test Org"));

    fireEvent.change(screen.getByDisplayValue("Test Org"), {
      target: { value: "Temp Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Test Org").length).toBeGreaterThan(0);
      expect(screen.queryByDisplayValue("Temp Name")).not.toBeInTheDocument();
    });
  });

  it("delete button disabled when org has events", async () => {
    setupFetch(orgHandlers(mockOrgWithEvents));
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(screen.getByRole("button", { name: /delete organization/i })).toBeDisabled();
    expect(screen.getByText(/cannot delete/i)).toBeInTheDocument();
  });

  it("delete button enabled when no events, opens confirm dialog", async () => {
    setupFetch(orgHandlers());
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    const deleteBtn = screen.getByRole("button", { name: /delete organization/i });
    expect(deleteBtn).not.toBeDisabled();

    fireEvent.click(deleteBtn);
    await waitFor(() =>
      expect(screen.getByText(/permanently delete/i)).toBeInTheDocument(),
    );
  });

  it("confirm delete calls DELETE endpoint", async () => {
    const mock = setupFetch([
      ...orgHandlers(),
      { url: `/api/admin/organizations/${ORG_ID}/invitations`, method: "POST", response: { invitation: { id: "inv-new" } }, status: 201 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    fireEvent.click(screen.getByRole("button", { name: /delete organization/i }));
    await waitFor(() => screen.getByText(/permanently delete/i));

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      const deleteCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes(`/api/admin/organizations/${ORG_ID}`) &&
          (opts as RequestInit)?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });
  });
});

// ─── Details tab — non-owner ──────────────────────────────────────────────────

describe("OrgDetailsTab — non-owner", () => {
  it("hides edit and delete for non-owner member", async () => {
    const nonOwnerProfile = { admin: { ...mockProfile.admin, id: "admin-other" } };
    setupFetch([
      { url: "/api/admin/profile", response: nonOwnerProfile },
      { url: "/api/admin/organizations", response: { organizations: [mockOrg] } },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));

    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete organization/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── Members tab ──────────────────────────────────────────────────────────────

describe("OrgMembersTab", () => {
  async function renderMembersTab(fetchHandlers = orgHandlers()) {
    setupFetch(fetchHandlers);
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /members/i }));
    await waitFor(() => screen.getByText("Owner User"));
  }

  it("renders member names, emails, and Owner chip", async () => {
    await renderMembersTab();
    expect(screen.getByText("Owner User")).toBeInTheDocument();
    expect(screen.getByText("Member User")).toBeInTheDocument();
    expect(screen.getByText("member@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Owner")[0]).toBeInTheDocument();
  });

  it("shows permission chips for non-owner members", async () => {
    await renderMembersTab();
    expect(screen.getByText("Community")).toBeInTheDocument();
    expect(screen.getByText("Support Tickets")).toBeInTheDocument();
  });

  it("owner sees edit-permissions button for non-owner members", async () => {
    await renderMembersTab();
    expect(
      screen.getAllByRole("button", { name: /edit permissions/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("permissions dialog opens with member's current permissions", async () => {
    await renderMembersTab();

    fireEvent.click(screen.getAllByRole("button", { name: /edit permissions/i })[0]);
    await waitFor(() => screen.getByRole("dialog"));

    expect(screen.getByRole("checkbox", { name: /community/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /support tickets/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /event approval/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /finances/i })).not.toBeChecked();
  });

  it("save in permissions dialog calls PATCH with updated permissions", async () => {
    const mock = setupFetch([
      ...orgHandlers(),
      {
        url: `/api/admin/organizations/${ORG_ID}/members/admin-2`,
        method: "PATCH",
        response: { membership: { permissions: ["EVENT_APPROVAL"] } },
      },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /members/i }));
    await waitFor(() => screen.getByText("Owner User"));

    fireEvent.click(screen.getAllByRole("button", { name: /edit permissions/i })[0]);
    await waitFor(() => screen.getByRole("dialog"));

    // Uncheck COMMUNITY, check EVENT_APPROVAL
    fireEvent.click(screen.getByRole("checkbox", { name: /community/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /event approval/i }));

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const patchCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes("/members/admin-2") &&
          (opts as RequestInit)?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall as [string, RequestInit])[1].body as string) as {
        permissions: string[];
      };
      expect(body.permissions).not.toContain("COMMUNITY");
      expect(body.permissions).toContain("EVENT_APPROVAL");
    });
  });

  it("remove member button calls DELETE", async () => {
    const mock = setupFetch([
      ...orgHandlers(),
      {
        url: `/api/admin/organizations/${ORG_ID}/members/admin-2`,
        method: "DELETE",
        response: { success: true },
      },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /members/i }));
    await waitFor(() => screen.getByText("Member User"));

    fireEvent.click(screen.getByRole("button", { name: /remove member/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => {
      const deleteCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes("/members/admin-2") &&
          (opts as RequestInit)?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it("non-owner sees no edit-permissions or remove buttons", async () => {
    const nonOwnerProfile = { admin: { ...mockProfile.admin, id: "admin-2" } };
    setupFetch([
      { url: "/api/admin/profile", response: nonOwnerProfile },
      { url: "/api/admin/organizations", response: { organizations: [mockOrg] } },
      {
        url: `/api/admin/organizations/${ORG_ID}/members`,
        response: { members: mockMembers },
      },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /members/i }));
    await waitFor(() => screen.getByText("Owner User"));

    expect(
      screen.queryByRole("button", { name: /edit permissions/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove member/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── Invitations tab — owner ──────────────────────────────────────────────────

describe("OrgInvitationsTab — owner", () => {
  async function renderInvitationsTab() {
    setupFetch(orgHandlers());
    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /invitations/i }));
    await waitFor(() => screen.getAllByText("Send Invitation"));
  }

  it("shows send invitation form for owner", async () => {
    await renderInvitationsTab();
    expect(screen.getByRole("textbox", { name: /email address/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invitation/i })).toBeInTheDocument();
  });

  it("shows permission checkboxes in the send form", async () => {
    await renderInvitationsTab();
    expect(screen.getByRole("checkbox", { name: /community/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /support tickets/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /event approval/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /finances/i })).toBeInTheDocument();
  });

  it("shows existing invitation with status chip", async () => {
    await renderInvitationsTab();
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("send invitation calls POST with email and selected permissions", async () => {
    const mock = setupFetch([
      ...orgHandlers(),
      { url: `/api/admin/organizations/${ORG_ID}/invitations`, method: "POST", response: { invitation: { id: "inv-new" } }, status: 201 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /invitations/i }));
    await waitFor(() => screen.getAllByText("Send Invitation"));

    fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /community/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /event approval/i }));

    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() => {
      const postCall = mock.mock.calls.find(
        ([url, opts]) =>
          (url as string).includes(`/api/admin/organizations/${ORG_ID}/invitations`) &&
          (opts as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall as [string, RequestInit])[1].body as string) as {
        email: string;
        permissions: string[];
      };
      expect(body.email).toBe("new@example.com");
      expect(body.permissions).toContain("COMMUNITY");
      expect(body.permissions).toContain("EVENT_APPROVAL");
      expect(body.permissions).not.toContain("SUPPORT_TICKETS");
    });
  });

  it("shows success message after sending", async () => {
    setupFetch([
      ...orgHandlers(),
      { url: `/api/admin/organizations/${ORG_ID}/invitations`, method: "POST", response: { invitation: { id: "inv-new" } }, status: 201 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /invitations/i }));
    await waitFor(() => screen.getAllByText("Send Invitation"));

    fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() =>
      expect(screen.getByText(/invitation sent to new@example\.com/i)).toBeInTheDocument(),
    );
  });

  it("shows server error when invitation fails", async () => {
    setupFetch([
      ...orgHandlers(),
      { url: `/api/admin/organizations/${ORG_ID}/invitations`, method: "POST", response: { error: "User is already a member of this organization" }, status: 409 },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /invitations/i }));
    await waitFor(() => screen.getAllByText("Send Invitation"));

    fireEvent.change(screen.getByRole("textbox", { name: /email address/i }), {
      target: { value: "existing@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() =>
      expect(
        screen.getByText("User is already a member of this organization"),
      ).toBeInTheDocument(),
    );
  });
});

// ─── Invitations tab — non-owner ──────────────────────────────────────────────

describe("OrgInvitationsTab — non-owner", () => {
  it("hides send invitation form", async () => {
    const nonOwnerProfile = { admin: { ...mockProfile.admin, id: "admin-2" } };
    setupFetch([
      { url: "/api/admin/profile", response: nonOwnerProfile },
      { url: "/api/admin/organizations", response: { organizations: [mockOrg] } },
      {
        url: `/api/admin/organizations/${ORG_ID}/invitations`,
        response: { invitations: mockInvitations },
      },
    ]);

    render(<OrgSettings />);
    await waitFor(() => screen.getAllByText("Test Org"));
    fireEvent.click(screen.getByRole("tab", { name: /invitations/i }));

    await waitFor(() =>
      expect(screen.queryByText("Send Invitation")).not.toBeInTheDocument(),
    );
    // Still shows invitation list
    expect(screen.getByText("invited@example.com")).toBeInTheDocument();
  });
});
