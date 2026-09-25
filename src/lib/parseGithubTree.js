/**
 * parseGithubTree.js
 *
 * Converts the flat list of items returned by GitHub's
 * GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
 * into a nested tree of nodes compatible with FileSystemMap.
 *
 * GitHub item shape:
 *   { path: "src/components/Button.jsx", type: "blob" | "tree", sha, url, size? }
 *
 * Output node shape:
 *   { name: string, path: string, type: "file" | "folder", children: Node[] }
 */

/**
 * @param {Array<{ path: string, type: "blob" | "tree" }>} flatItems
 * @returns {Array<Node>} Top-level nodes sorted folders-first then alphabetically
 */
export function parseGithubTree(flatItems) {
  // A map from path string → the node object we're building.
  // We include the virtual root ("")  so we always have a place to attach.
  const nodeMap = new Map();
  nodeMap.set("", { name: "", path: "", type: "folder", children: [] });

  // Sort items so that parent folders are always processed before their children.
  // GitHub returns them in lexicographic order already, but let's be explicit.
  const sorted = [...flatItems].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const type = item.type === "tree" ? "folder" : "file";
    const segments = item.path.split("/");
    const name = segments[segments.length - 1];

    const node = {
      name,
      path: item.path,
      type,
      children: type === "folder" ? [] : undefined,
    };

    nodeMap.set(item.path, node);

    // Find the parent — everything before the last slash.
    const parentPath = segments.slice(0, -1).join("/");

    // If the parent doesn't exist yet (shouldn't happen with recursive=1, but
    // handle gracefully), create a synthetic folder node.
    if (!nodeMap.has(parentPath)) {
      const parentName = parentPath.split("/").pop();
      nodeMap.set(parentPath, {
        name: parentName,
        path: parentPath,
        type: "folder",
        children: [],
      });
    }

    nodeMap.get(parentPath).children.push(node);
  }

  // Return the top-level children of the virtual root, sorted.
  return sortNodes(nodeMap.get("").children);
}

/**
 * Recursively sorts a node array: folders first, then files, both alphabetically.
 * @param {Array<Node>} nodes
 * @returns {Array<Node>}
 */
function sortNodes(nodes) {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .map((node) => {
      if (node.type === "folder" && node.children?.length) {
        return { ...node, children: sortNodes(node.children) };
      }
      return node;
    });
}

/**
 * Returns the total number of files (blobs) in a subtree.
 * Used by fileTypeGuess to show "N files inside" for folders.
 * @param {Node} node
 * @returns {number}
 */
export function countFiles(node) {
  if (node.type === "file") return 1;
  if (!node.children?.length) return 0;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

/**
 * Flattens the nested tree back to a flat list of all nodes (depth-first).
 * Useful for search or stats.
 * @param {Array<Node>} nodes
 * @returns {Array<Node>}
 */
export function flattenTree(nodes) {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flattenTree(node.children) : []),
  ]);
}
