import WorkspaceClient from "./WorkspaceClient";

export const metadata = {
  title: "Workspace",
  description:
    "Explore a visual codebase map and plain-English code explanations in Sprout.",
  openGraph: {
    title: "Sprout Workspace",
    description: "Explore a visual codebase map and clear code explanations.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

// Server Component: exports metadata, delegates rendering to WorkspaceClient
export default function WorkspacePage() {
  return <WorkspaceClient />;
}
