let skills = [];
let selectedSkillId;
let toastTimer;

const elements = {
  list: document.querySelector("#skill-list"),
  count: document.querySelector("#skill-count"),
  empty: document.querySelector("#empty-state"),
  form: document.querySelector("#skill-form"),
  title: document.querySelector("#editor-title"),
  name: document.querySelector("#skill-name"),
  description: document.querySelector("#skill-description"),
  prompt: document.querySelector("#skill-prompt"),
  runPanel: document.querySelector("#run-panel"),
  runSource: document.querySelector("#run-source"),
  runResult: document.querySelector("#run-result"),
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
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
  });
  if (response.status === 204) return undefined;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function selectedSkill() {
  return skills.find((skill) => skill.id === selectedSkillId);
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
        <span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span>
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
    elements.prompt.value = selected.prompt;
  }

  document.querySelectorAll("[data-skill-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSkillId = button.dataset.skillId;
      elements.runResult.hidden = true;
      render();
    });
  });
}

async function loadSkills() {
  const data = await request("/api/skills");
  skills = data.skills;
  if (!selectedSkill() && skills.length) selectedSkillId = skills[0].id;
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
      }),
    });
    selectedSkillId = data.skill.id;
    await loadSkills();
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
      }),
    });
    await loadSkills();
    showToast("Skill 已保存");
  } catch (error) {
    showToast(error.message, true);
  }
});

document.querySelector("#delete-skill").addEventListener("click", async () => {
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

loadSkills().catch((error) => {
  elements.list.innerHTML = `<p class="list-empty">加载失败：${escapeHtml(error.message)}</p>`;
  showToast(error.message, true);
});
