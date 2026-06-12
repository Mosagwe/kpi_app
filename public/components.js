export function QuarterCard({ quarter, label, drafted, progress, onOpen, onDelete }) {
  const template = document.querySelector("#quarter-template");
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector(".quarter-badge").textContent = `Q${quarter.quarter}`;
  card.querySelector(".quarter-label").textContent = label;
  card.querySelector(".quarter-meta").textContent =
    `${quarter.kpis.length} KPIs | ${drafted} achievements drafted`;
  card.querySelector(".quarter-progress").textContent = `${progress}% complete`;
  card.querySelector(".quarter-open").addEventListener("click", onOpen);
  const deleteButton = card.querySelector(".quarter-delete");
  deleteButton.setAttribute("aria-label", `Delete ${label}`);
  deleteButton.addEventListener("click", onDelete);
  return card;
}

export function MasterKpiRow({ kpi, index, onEdit }) {
  const row = document.createElement("article");
  row.className = "master-kpi-row";

  const indexBox = document.createElement("span");
  indexBox.className = "master-index";
  indexBox.textContent = index + 1;

  const copy = document.createElement("div");
  copy.className = "master-kpi-copy";
  const category = document.createElement("span");
  category.className = "category";
  category.textContent = kpi.category;
  const title = document.createElement("strong");
  title.textContent = kpi.title;
  copy.append(category, title);

  const measure = document.createElement("div");
  measure.className = "master-measure-preview";
  measure.textContent = kpi.measure || "No tactical measure supplied";

  const weight = document.createElement("span");
  weight.className = "master-weight";
  weight.textContent = `${kpi.weight || 0}% weight`;

  const edit = document.createElement("button");
  edit.className = "button ghost";
  edit.textContent = "Edit";
  edit.addEventListener("click", onEdit);

  row.append(indexBox, copy, measure, weight, edit);
  return row;
}

