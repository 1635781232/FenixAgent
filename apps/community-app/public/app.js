let skills = [];
let organizationSnapshot;
let selectedSkillId;
let selectedAccess;
let isEditing = false;
let toastTimer;

const elements = {
  list: document.querySelector("#skill-list"),
  count: document.querySelector("#skill-count"),
  empty: document.querySelector("#empty-state"),
  form: document.querySelector("#skill-form"),
  title: document.querySelector("#editor-title"),
  name: document.querySelector("#skill-name"),
  description: document.querySelector("#skill-description"),
  status: document.querySelector("#skill-status"),
  keyword: document.querySelector("#skill-keyword"),
  statusFilter: document.querySelector("#skill-status-filter"),
  authorizationSummary: document.querySelector("#authorization-summary"),
  currentUser: document.querySelector("#current-user"),
  prompt: document.querySelector("#skill-prompt"),
  editAccess: document.querySelector("#edit-access"),
  editSkill: document.querySelector("#edit-skill"),
  deleteSkill: document.querySelector("#delete-skill"),
  formActions: document.querySelector("#form-actions"),
  cancelEdit: document.querySelector("#cancel-edit"),
  runPanel: document.querySelector("#run-panel"),
  runSource: document.querySelector("#run-source"),
  runResult: document.querySelector("#run-result"),
  organizationTree: document.querySelector("#organization-tree"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (elements.currentUser.value) headers.set("x-demo-user-id", elements.currentUser.value);
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function selectedSkill() {
  return skills.find((skill) => skill.id === selectedSkillId);
}

function renderOrganization(organization) {
  const membersByDepartment = new Map();
  for (const member of organization.members) {
    const members = membersByDepartment.get(member.departmentId) ?? [];
    members.push(member);
    membersByDepartment.set(member.departmentId, members);
  }

  const departmentsByParent = new Map();
  for (const department of organization.departments) {
    const key = department.parentId ?? "root";
    const departments = departmentsByParent.get(key) ?? [];
    departments.push(department);
    departmentsByParent.set(key, departments);
  }

  const departmentCard = (department, child = false) => {
    const members = membersByDepartment.get(department.id) ?? [];
    return `
      <article class="department-card${child ? " child" : ""}">
        <div class="department-name"><span>${child ? "↳" : "◆"}</span><strong>${escapeHtml(department.name)}</strong></div>
        ${members.map((member) => `
          <div class="member-row${member.id === elements.currentUser.value ? " current" : ""}">
            <span class="member-avatar">${escapeHtml(member.name.slice(0, 1))}</span>
            <span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.role)}</small></span>
          </div>
        `).join("")}
      </article>
    `;
  };

  const roots = departmentsByParent.get("root") ?? [];
  elements.organizationTree.innerHTML = roots.map((root) => `
    <div class="organization-branch">
      ${departmentCard(root)}
      <div class="child-departments">
        ${(departmentsByParent.get(root.id) ?? []).map((department) => departmentCard(department, true)).join("")}
      </div>
    </div>
  `).join("");
}

async function loadOrganization() {
  const data = await request("/api/organization");
  organizationSnapshot = data.organization;
  elements.currentUser.innerHTML = data.organization.members.map((member) => `
    <option value="${escapeHtml(member.id)}">${escapeHtml(member.name)} · ${escapeHtml(member.role)}</option>
  `).join("");
  renderOrganization(data.organization);
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 2600);
}

function render() {
  const selected = selectedSkill();
  elements.count.textContent = String(skills.length);
  elements.list.innerHTML = skills.length
    ? skills.map((skill) => `
      <button class="skill-item ${skill.id === selectedSkillId ? "selected" : ""}" data-skill-id="${escapeHtml(skill.id)}">
        <span class="skill-avatar">✦</span>
        <span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small><em class="status-badge ${escapeHtml(skill.status)}">${skill.status === "published" ? "已发布" : "草稿"}</em></span>
      </button>
    `).join("")
    : '<p class="list-empty">还没有 Skill，点击右上角新建。</p>';

  elements.empty.hidden = Boolean(selected);
  elements.form.hidden = !selected;
  elements.runPanel.hidden = !selected;
  if (selected) {
    elements.title.textContent = selected.name;
    elements.name.value = selected.name;
    elements.description.value = selected.description;
    elements.status.value = selected.status;
    elements.prompt.value = selected.prompt;
    const canEdit = selectedAccess?.canEdit === true;
    const canDelete = selectedAccess?.canDelete === true;
    elements.editAccess.textContent = selectedAccess === undefined
      ? "正在检查编辑权限…"
      : canEdit ? "编辑权限：允许" : "编辑权限：拒绝";
    elements.editAccess.className = `access-state${selectedAccess === undefined ? "" : canEdit ? " allowed" : " denied"}`;
    elements.editSkill.hidden = !canEdit || isEditing;
    elements.deleteSkill.hidden = !canDelete || isEditing;
    elements.formActions.hidden = !isEditing;
    for (const field of [elements.name, elements.description, elements.status, elements.prompt]) {
      field.disabled = !isEditing;
    }
  }

  document.querySelectorAll("[data-skill-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectSkill(button.dataset.skillId).catch((error) => showToast(error.message, true));
    });
  });
}

async function selectSkill(skillId) {
  selectedSkillId = skillId;
  selectedAccess = undefined;
  isEditing = false;
  elements.runResult.hidden = true;
  render();
  await loadSelectedAccess();
  render();
}

async function loadSelectedAccess() {
  if (!selectedSkillId) {
    selectedAccess = undefined;
    return;
  }
  const data = await request(`/api/skills/${encodeURIComponent(selectedSkillId)}/access`);
  selectedAccess = data.permissions;
}

async function loadSkills() {
  const query = new URLSearchParams();
  if (elements.keyword.value.trim()) query.set("keyword", elements.keyword.value.trim());
  if (elements.statusFilter.value) query.set("status", elements.statusFilter.value);
  const data = await request(`/api/skills${query.size ? `?${query}` : ""}`);
  skills = data.skills;
  elements.authorizationSummary.textContent = `${data.authorization.principalId} · ${data.authorization.action} · Community Provider 通过 · 返回 ${data.authorization.returned}/${data.authorization.candidates}`;
  if (!selectedSkill() && skills.length) {
    selectedSkillId = skills[0].id;
    selectedAccess = undefined;
    isEditing = false;
  }
  if (!skills.length) {
    selectedSkillId = undefined;
    selectedAccess = undefined;
    isEditing = false;
  }
  await loadSelectedAccess();
  render();
}

document.querySelector("#create-skill").addEventListener("click", async () => {
  try {
    const data = await request("/api/skills", {
      method: "POST",
      body: JSON.stringify({
        name: "未命名 Skill",
        description: "请补充这个 Skill 的用途。",
        prompt: "请描述该 Skill 应完成的任务。",
        status: "draft",
      }),
    });
    selectedSkillId = data.skill.id;
    await loadSkills();
    isEditing = selectedAccess?.canEdit === true;
    render();
    elements.name.focus();
    showToast("已创建新的 Skill");
  } catch (error) {
    showToast(error.message, true);
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedSkillId) return;
  try {
    await request(`/api/skills/${encodeURIComponent(selectedSkillId)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: elements.name.value,
        description: elements.description.value,
        prompt: elements.prompt.value,
        status: elements.status.value,
      }),
    });
    isEditing = false;
    await loadSkills();
    showToast("Skill 已保存");
  } catch (error) {
    showToast(error.message, true);
  }
});

let filterTimer;
elements.keyword.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => loadSkills().catch((error) => showToast(error.message, true)), 220);
});
elements.statusFilter.addEventListener("change", () => {
  loadSkills().catch((error) => showToast(error.message, true));
});

elements.currentUser.addEventListener("change", () => {
  selectedSkillId = undefined;
  selectedAccess = undefined;
  isEditing = false;
  if (organizationSnapshot) renderOrganization(organizationSnapshot);
  loadSkills().catch((error) => showToast(error.message, true));
});

elements.editSkill.addEventListener("click", () => {
  if (!selectedAccess?.canEdit) return;
  isEditing = true;
  render();
  elements.name.focus();
});

elements.cancelEdit.addEventListener("click", () => {
  isEditing = false;
  render();
});

elements.deleteSkill.addEventListener("click", async () => {
  const selected = selectedSkill();
  if (!selected || !window.confirm(`确定删除“${selected.name}”吗？`)) return;
  try {
    await request(`/api/skills/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
    selectedSkillId = undefined;
    elements.runResult.hidden = true;
    await loadSkills();
    showToast("Skill 已删除");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector("#run-skill").addEventListener("click", async () => {
  if (!selectedSkillId) return;
  try {
    const data = await request(`/api/skills/${encodeURIComponent(selectedSkillId)}/run`, {
      method: "POST",
      body: JSON.stringify({ source: elements.runSource.value }),
    });
    elements.runResult.textContent = data.result.output;
    elements.runResult.hidden = false;
    showToast("Skill 已运行");
  } catch (error) {
    showToast(error.message, true);
  }
});

loadOrganization().then(loadSkills).catch((error) => {
  elements.list.innerHTML = `<p class="list-empty">加载失败：${escapeHtml(error.message)}</p>`;
  elements.organizationTree.innerHTML = `<p class="list-empty">组织加载失败：${escapeHtml(error.message)}</p>`;
  showToast(error.message, true);
});
