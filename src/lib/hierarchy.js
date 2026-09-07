export function pointKey(point, idx) {
  return `${point.sourceTable || "points"}::${point.id ?? idx}`;
}

function inferGroupName(point) {
  const candidate = String(point.code || point.description || point.id || "").trim();
  if (!candidate) {
    return "Ungrouped";
  }
  const m = candidate.match(/^[A-Za-z]+/);
  if (m) {
    return m[0];
  }
  return "Ungrouped";
}

function inferRole(point) {
  const tokens = point?.raw?.tokens || [];
  const joined = tokens.join(" ").toLowerCase();
  if (joined.includes("stake out")) {
    return "Stake Out";
  }
  if (joined.includes("calculated")) {
    return "Calculated";
  }
  if (joined.includes("control point")) {
    return "Control Point";
  }
  if (joined.includes("user entered")) {
    return "User Entered";
  }
  return "Unclassified";
}

function sortByName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function buildPointHierarchy(points) {
  const sourceMap = new Map();

  points.forEach((point, idx) => {
    const key = pointKey(point, idx);
    const sourceName = point.sourceTable || "Points";
    const groupName = inferGroupName(point);
    const roleName = inferRole(point);

    if (!sourceMap.has(sourceName)) {
      sourceMap.set(sourceName, new Map());
    }
    const groupMap = sourceMap.get(sourceName);
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, new Map());
    }
    const roleMap = groupMap.get(groupName);
    if (!roleMap.has(roleName)) {
      roleMap.set(roleName, []);
    }
    roleMap.get(roleName).push({ key, point });
  });

  const sourceNodes = [];
  for (const [sourceName, groupMap] of sourceMap.entries()) {
    const groupNodes = [];
    for (const [groupName, roleMap] of groupMap.entries()) {
      const roleNodes = [];
      for (const [roleName, pointList] of roleMap.entries()) {
        const pointNodes = pointList
          .map((item) => ({
            id: `point:${item.key}`,
            name: String(item.point.code || item.point.id || item.key),
            type: "point",
            pointKeys: [item.key],
            children: [],
          }))
          .sort(sortByName);
        roleNodes.push({
          id: `role:${sourceName}:${groupName}:${roleName}`,
          name: roleName,
          type: "role",
          pointKeys: pointNodes.flatMap((n) => n.pointKeys),
          children: pointNodes,
        });
      }
      roleNodes.sort(sortByName);
      groupNodes.push({
        id: `group:${sourceName}:${groupName}`,
        name: groupName,
        type: "group",
        pointKeys: roleNodes.flatMap((n) => n.pointKeys),
        children: roleNodes,
      });
    }
    groupNodes.sort(sortByName);
    sourceNodes.push({
      id: `source:${sourceName}`,
      name: sourceName,
      type: "source",
      pointKeys: groupNodes.flatMap((n) => n.pointKeys),
      children: groupNodes,
    });
  }

  sourceNodes.sort(sortByName);
  return sourceNodes;
}
