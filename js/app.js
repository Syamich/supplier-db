const SUPABASE_URL = "https://eicttpaoqxbxjejcdjgr.supabase.co"
const SUPABASE_ANON_KEY = "sb_publishable_vYjsauNadHREOmydN9jYmA_igES_tYh"

const client =
  typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_ANON_KEY
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null

let currentMode = "login"
let isAuthLoading = false
let currentUser = null
let allSuppliers = []
let supplierFormData = {}
let searchData = {}
let managers = 0
let isSavingSupplier = false
let supplierDetailsOverlay = null
let isSupplierModalClosing = false
let appAlertOverlay = null
let appAlertResolve = null
let appAlertMode = "alert"
let isInnAutofillLoading = false
const PAGE_SIZE = 100
let findCurrentPage = 1
let lkCurrentPage = 1
let isSuppliersRefreshing = false

const pageArea = document.querySelector(".page-area")
const popupElement = document.getElementById("popup")
const findOutputTitle = document.querySelector(".find-output-title")
const findOutputList = document.querySelector(".find-supplier .find-output-list")
const lkOutputTitle = document.querySelector(".lk-output-title")
const lkOutputList = document.querySelector(".lk-suppliers .find-output-list")
const addInnInput = document.querySelector('.add-form-input[name="inn"]')
const addAutofillBtn = document.querySelector(".add-form-autofill")
const findRefreshSpinner = createRefreshSpinner()
const lkRefreshSpinner = createRefreshSpinner()

window.addEventListener("load", async () => {
  showSuppliersLoadingState()

  if (!client) {
    popupElement?.classList.add("hidden")
    await showAppAlert("Supabase не настроен: заполните URL и ключ", { type: "error" })
    setSuppliersRefreshing(false)
    return
  }

  try {
    const {
      data: { user }
    } = await client.auth.getUser()

    if (!user) {
      showPopup()
      setSuppliersRefreshing(false)
      return
    }

    currentUser = user
    const hasAccess = await checkWhitelistAccess()

    if (!hasAccess) {
      await client.auth.signOut()
      showPopup()
      await showAppAlert("Нет доступа: ваша почта не в whitelist", { type: "error" })
      setSuppliersRefreshing(false)
      return
    }

    hidePopup()
    applySuppliersFromCache()
    await refreshSuppliers()
  } catch (err) {
    console.error("Auth check error:", err)
    showPopup()
    setSuppliersRefreshing(false)
  }
})

const addManagersBtn = document.querySelector(".add-form-managers-btn")
addManagersBtn?.addEventListener("click", function (e) {
  e.preventDefault()
  addManagerInputs()
})

const clearAddInputsBtn = document.querySelector(".add-form-cancel")
clearAddInputsBtn?.addEventListener("click", async function (e) {
  e.preventDefault()
  await clearAddInputs()
})

addInnInput?.addEventListener("input", function () {
  updateInnAutofillButtonState()
})

addAutofillBtn?.addEventListener("click", async function (e) {
  e.preventDefault()
  await autofillSupplierByInn()
})
updateInnAutofillButtonState()

document.querySelector(".add-form-save")?.addEventListener("click", async function (e) {
  e.preventDefault()
  if (isSavingSupplier) return
  if (!currentUser) {
    await showAppAlert("Сначала войдите в систему", { type: "error" })
    showPopup()
    return
  }

  isSavingSupplier = true
  const saveBtn = document.querySelector(".add-form-save")
  const saveBtnText = saveBtn?.innerText
  if (saveBtn) {
    saveBtn.innerText = "Загрузка..."
    saveBtn.disabled = true
  }

  try {
    collectFormData()
    const validationError = validateSupplierData(supplierFormData)
    if (validationError) {
      await showAppAlert(validationError, { type: "error" })
      return
    }

    const hasDuplicate = await checkSupplierInnExists(supplierFormData.inn)
    if (hasDuplicate) {
      await showAppAlert("Поставщик с таким ИНН уже существует", { type: "error" })
      return
    }

    const payload = {
      ...supplierFormData,
      created_by: currentUser.id
    }

    const { error } = await client.from("suppliers").insert(payload)
    if (error) {
      console.error("Ошибка добавления supplier:", error)
      await showAppAlert(`Ошибка добавления: ${error.message}`, { type: "error" })
      return
    }

    await showAppAlert("Поставщик добавлен", { type: "success" })
    await clearAddInputs(false)
    await refreshSuppliers()
  } finally {
    isSavingSupplier = false
    if (saveBtn) {
      saveBtn.innerText = saveBtnText || "Добавить"
      saveBtn.disabled = false
    }
  }
})

document.querySelector(".find-supplier")?.addEventListener("input", function () {
  collectSearchData()
  findCurrentPage = 1
  renderSuppliers()
})

document.querySelector(".lk-suppliers")?.addEventListener("input", function () {
  lkCurrentPage = 1
  renderSuppliers()
})

function switchTab(mode) {
  currentMode = mode

  document.getElementById("loginTab")?.classList.remove("active")
  document.getElementById("registerTab")?.classList.remove("active")

  const actionBtn = document.getElementById("actionBtn")
  if (mode === "login") {
    document.getElementById("loginTab")?.classList.add("active")
    if (actionBtn) actionBtn.innerText = "Войти"
  } else {
    document.getElementById("registerTab")?.classList.add("active")
    if (actionBtn) actionBtn.innerText = "Зарегистрироваться"
  }
}

async function handleAuth() {
  if (isAuthLoading) return

  if (!client) {
    await showAppAlert("Supabase не настроен: заполните SUPABASE_URL и SUPABASE_ANON_KEY", {
      type: "error"
    })
    return
  }

  const email = document.getElementById("email").value.trim()
  const password = document.getElementById("password").value

  if (!email || !password) {
    await showAppAlert("Введите email и пароль", { type: "error" })
    return
  }

  setAuthButtonLoading(true)
  isAuthLoading = true

  try {
    if (currentMode === "login") {
      const { error } = await client.auth.signInWithPassword({ email, password })
      if (error) {
        await showAppAlert(`Ошибка входа: ${error.message}`, { type: "error" })
        return
      }

      const {
        data: { user }
      } = await client.auth.getUser()
      currentUser = user

      const hasAccess = await checkWhitelistAccess()
      if (!hasAccess) {
        await client.auth.signOut()
        showPopup()
        await showAppAlert("Нет доступа: ваша почта не в whitelist", { type: "error" })
        return
      }

      hidePopup()
      await refreshSuppliers()
      return
    }

    const { error } = await client.auth.signUp({ email, password })
    if (error) {
      await showAppAlert(`Ошибка регистрации: ${error.message}`, { type: "error" })
      return
    }

    await showAppAlert("Регистрация успешна. Теперь войдите в систему.", { type: "success" })
    switchTab("login")
  } finally {
    isAuthLoading = false
    setAuthButtonLoading(false)
    updateInnAutofillButtonState()
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const tabBtns = document.querySelectorAll(".tab")
  const tabs = document.querySelectorAll(".tab-block")
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      tabBtns.forEach((button) => button.classList.remove("active"))
      this.classList.add("active")
      const currentTab = Number(this.getAttribute("data-number"))
      tabs.forEach((tab) => tab.classList.add("hidden"))
      if (tabs[currentTab - 1]) tabs[currentTab - 1].classList.remove("hidden")
    })
  })
  if (tabBtns[1]) tabBtns[1].click()

  const htmlElement = document.documentElement
  const darkBtn = document.getElementById("darkmode-toggle")
  const savedTheme = localStorage.getItem("theme")
  if (savedTheme === "dark") {
    htmlElement.classList.add("dark-mode")
    if (darkBtn) darkBtn.checked = true
  }

  darkBtn?.addEventListener("change", function () {
    if (this.checked) {
      htmlElement.classList.add("dark-mode")
      localStorage.setItem("theme", "dark")
    } else {
      htmlElement.classList.remove("dark-mode")
      localStorage.setItem("theme", "light")
    }
  })
})

async function checkWhitelistAccess() {
  const { data, error } = await client.rpc("is_allowed_email")
  if (error) {
    console.error("Ошибка проверки whitelist:", error)
    return false
  }
  return Boolean(data)
}

async function refreshSuppliers() {
  setSuppliersRefreshing(true)
  const { data, error } = await client
    .from("suppliers")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Ошибка загрузки suppliers:", error)
    if (!allSuppliers.length) allSuppliers = []
    renderSuppliers()
    setSuppliersRefreshing(false)
    return
  }

  allSuppliers = Array.isArray(data) ? data : []
  cacheSuppliers(allSuppliers)
  renderSuppliers()
  setSuppliersRefreshing(false)
}

function renderSuppliers() {
  const filteredForFind = applyFindFilters(allSuppliers, searchData)
  const mySuppliers = allSuppliers.filter((supplier) => supplier.created_by === currentUser?.id)
  const filteredForLk = applyLkFilters(mySuppliers)
  const findTotalPages = Math.max(1, Math.ceil(filteredForFind.length / PAGE_SIZE))
  const lkTotalPages = Math.max(1, Math.ceil(filteredForLk.length / PAGE_SIZE))
  findCurrentPage = Math.min(findCurrentPage, findTotalPages)
  lkCurrentPage = Math.min(lkCurrentPage, lkTotalPages)

  renderList(findOutputList, findOutputTitle, filteredForFind, "Ничего не найдено", "find")
  renderList(lkOutputList, lkOutputTitle, filteredForLk, "У вас пока нет поставщиков", "lk")
  updateRefreshIndicators()
}

function renderList(container, titleNode, list, emptyText, mode) {
  if (!container || !titleNode) return
  container.innerHTML = ""
  const canDelete = mode === "lk"
  if (!list.length) {
    titleNode.textContent = emptyText
    return
  }

  const currentPage = mode === "find" ? findCurrentPage : lkCurrentPage
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const endIndex = startIndex + PAGE_SIZE
  const pagedList = list.slice(startIndex, endIndex)

  titleNode.textContent = `Найдено: ${list.length} | Страница ${currentPage} из ${totalPages}`
  const table = document.createElement("div")
  table.className = "supplier-table"

  const header = document.createElement("div")
  header.className = "supplier-table__row supplier-table__row--header"
  header.innerHTML = `
    <div class="supplier-table__cell">Название</div>
    <div class="supplier-table__cell">ИНН</div>
    <div class="supplier-table__cell">СМСП</div>
    <div class="supplier-table__cell">Телефоны</div>
    <div class="supplier-table__cell">Почты</div>
    <div class="supplier-table__cell">Осн. ОКВЭД2</div>
    <div class="supplier-table__cell">Регион</div>
    <div class="supplier-table__cell">Комментарий</div>
    ${canDelete ? '<div class="supplier-table__cell supplier-table__cell--delete"></div>' : ""}
  `
  table.appendChild(header)

  pagedList.forEach((supplier) => {
    const name = supplier.name || "Без названия"
    const inn = supplier.inn || "-"
    const comment = supplier.comment || "-"
    const regions = toArray(supplier.region).join(", ") || "-"
    const okvedMain = toArray(supplier.okved_main).join(", ") || "-"
    const companyNumbers = toArray(supplier.company_number).join(", ") || "-"
    const companyMails = toArray(supplier.company_mail).join(", ") || "-"
    const smsp =
      supplier.is_smsp === true ? "Да (+)" : supplier.is_smsp === false ? "Нет (-)" : "Не указано"

    const row = document.createElement("div")
    row.className = "supplier-table__row"
    row.setAttribute("data-supplier-id", String(supplier.id))
    row.innerHTML = `
      <div class="supplier-table__cell"><b>${escapeHtml(name)}</b></div>
      <div class="supplier-table__cell">${escapeHtml(inn)}</div>
      <div class="supplier-table__cell">${escapeHtml(smsp)}</div>
      <div class="supplier-table__cell">${escapeHtml(companyNumbers)}</div>
      <div class="supplier-table__cell">${escapeHtml(companyMails)}</div>
      <div class="supplier-table__cell">${escapeHtml(okvedMain)}</div>
      <div class="supplier-table__cell">${escapeHtml(regions)}</div>
      <div class="supplier-table__cell">${escapeHtml(comment)}</div>
      ${
        canDelete
          ? `<div class="supplier-table__cell supplier-table__cell--delete">
        <button class="supplier-delete-btn" data-supplier-id="${escapeHtml(supplier.id)}" title="Удалить">✕</button>
      </div>`
          : ""
      }
    `
    table.appendChild(row)
  })

  container.appendChild(table)
  bindSupplierRowOpenDetails(container, pagedList)
  if (canDelete) bindDeleteButtons(container)
  renderPagination(container, totalPages, currentPage, mode)
}

function applyFindFilters(suppliers, filters) {
  return suppliers.filter((supplier) => {
    for (const [key, value] of Object.entries(filters)) {
      if (key === "find") {
        if (!matchValue(JSON.stringify(supplier).toLowerCase(), value)) return false
        continue
      }

      const fieldMap = {
        find_name: supplier.name,
        find_main_okved: supplier.okved_main,
        find_other_okved: supplier.okved_other,
        find_item: supplier.item,
        find_region: supplier.region,
        find_client: supplier.client,
        find_comment: supplier.comment,
        find_smsp:
          supplier.is_smsp === true ? "+" : supplier.is_smsp === false ? "-" : ""
      }

      if (!matchValue(fieldMap[key], value)) return false
    }
    return true
  })
}

function applyLkFilters(suppliers) {
  const inputs = document.querySelectorAll(".lk-suppliers input")
  const filters = {}
  inputs.forEach((input) => {
    const key = input.name
    const value = input.value.trim().toLowerCase()
    if (key && value) filters[key] = value
  })

  return suppliers.filter((supplier) => {
    for (const [key, value] of Object.entries(filters)) {
      if (key === "lk") {
        if (!JSON.stringify(supplier).toLowerCase().includes(value)) return false
        continue
      }

      const fieldMap = {
        "lk-find_name": supplier.name,
        "lk-find_main_okved": supplier.okved_main,
        "lk-find_other_okved": supplier.okved_other,
        "lk-find_item": supplier.item,
        "lk-find_region": supplier.region,
        "lk-find_client": supplier.client,
        "lk-find_comment": supplier.comment,
        "lk-find_smsp":
          supplier.is_smsp === true ? "+" : supplier.is_smsp === false ? "-" : ""
      }

      if (!matchValue(fieldMap[key], value)) return false
    }
    return true
  })
}

function matchValue(field, wanted) {
  if (Array.isArray(wanted)) return wanted.every((item) => matchValue(field, item))
  const text = Array.isArray(field)
    ? field.join(" ").toLowerCase()
    : String(field ?? "").toLowerCase()
  return text.includes(String(wanted).toLowerCase())
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function showPopup() {
  popupElement?.classList.remove("hidden")
  if (pageArea) pageArea.style.filter = "blur(1px)"
  updateInnAutofillButtonState()
}

function hidePopup() {
  popupElement?.classList.add("hidden")
  if (pageArea) pageArea.style.filter = "none"
  updateInnAutofillButtonState()
}

function addManagerInputs() {
  const nameInput = document.createElement("input")
  nameInput.classList.add("add-form-input", "manager-input")
  nameInput.setAttribute("data-manager-number", managers)
  nameInput.setAttribute("type", "text")
  nameInput.setAttribute("placeholder", "Имя...")
  nameInput.setAttribute("name", "manager_name")

  const phoneInput = document.createElement("input")
  phoneInput.classList.add("add-form-input", "manager-input")
  phoneInput.setAttribute("data-manager-number", managers)
  phoneInput.setAttribute("type", "tel")
  phoneInput.setAttribute("placeholder", "Номер телефона...")
  phoneInput.setAttribute("name", "manager_phone")

  const mailInput = document.createElement("input")
  mailInput.classList.add("add-form-input", "manager-input")
  mailInput.setAttribute("data-manager-number", managers)
  mailInput.setAttribute("type", "email")
  mailInput.setAttribute("placeholder", "Почта...")
  mailInput.setAttribute("name", "manager_mail")

  const removeInputsBtn = document.createElement("span")
  removeInputsBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.0" viewBox="0 0 100 100"><path d="M11.4 7.4c-.3.8 5.5 10.5 13.2 22L38.3 50 24.6 70.6c-7.7 11.5-13.5 21.2-13.2 22 .4 1 2.7 1.4 8.9 1.4 9.9 0 8.6 1.1 20.8-16.7C45.7 70.5 49.7 65 50 65s3.2 3.9 6.5 8.7S64.4 85 66.7 88.2L71 94h8.5c6.4 0 8.7-.4 9.1-1.4.3-.8-5.5-10.5-13.2-22L61.7 50l13.7-20.6c7.7-11.5 13.5-21.2 13.2-22-.4-1-2.7-1.4-9.1-1.4H71l-4.3 5.8c-2.3 3.2-6.9 9.7-10.2 14.5S50.3 35 50 35s-4.3-5.5-8.9-12.3C28.9 4.9 30.2 6 20.3 6c-6.2 0-8.5.4-8.9 1.4M39 24.5c5.5 8 10.5 14.5 11 14.5s5.5-6.5 11-14.5L71.2 10H85L72 29.5C64.9 40.2 59 49.4 59 50s5.9 9.8 13 20.5L85 90H71.2L61 75.5C55.5 67.5 50.5 61 50 61s-5.5 6.5-11 14.5L28.8 90H15l13-19.5C35.1 59.8 41 50.6 41 50s-5.9-9.8-13-20.5L15 10h13.8z" fill="#3d3d3d"/></svg>'
  removeInputsBtn.classList.add("managers-close-btn")
  removeInputsBtn.setAttribute("data-manager-number", managers)

  const line = document.createElement("div")
  line.classList.add("add-line")
  line.setAttribute("data-manager-number", managers)

  const inputBox = document.querySelector(".add-form-managers-inputs")
  inputBox.appendChild(nameInput)
  inputBox.appendChild(phoneInput)
  inputBox.appendChild(mailInput)
  inputBox.appendChild(removeInputsBtn)
  inputBox.appendChild(line)

  managers++
  removeInputsBtn.addEventListener("click", function () {
    inputBox.removeChild(nameInput)
    inputBox.removeChild(phoneInput)
    inputBox.removeChild(mailInput)
    inputBox.removeChild(removeInputsBtn)
    inputBox.removeChild(line)
  })
}

async function clearAddInputs(withConfirm = true) {
  const canClear = withConfirm
    ? await showAppConfirm("Вы уверены, что хотите очистить все поля?", {
        title: "Подтверждение",
        confirmText: "Очистить",
        cancelText: "Отмена"
      })
    : true
  if (!canClear) return

  const inputs = document.querySelectorAll(".add-form-input")
  inputs.forEach((input) => {
    input.value = ""
  })
  const smspInput = document.querySelector('.add-form-input[name="is_smsp"]')
  if (smspInput) smspInput.value = ""
  document.querySelector(".add-form-managers-inputs").innerHTML = ""
  updateInnAutofillButtonState()
}

function collectFormData() {
  const form = document.querySelector(".add-form")
  const inputs = form.querySelectorAll(".add-form-input")
  supplierFormData = { managers: [] }
  const managerGroups = {}

  inputs.forEach((input) => {
    const key = input.name
    const value = input.value.trim()
    if (!key) return

    if (input.classList.contains("manager-input")) {
      const index = input.dataset.managerNumber
      if (!managerGroups[index]) managerGroups[index] = { name: "", phone: "", mail: "" }
      if (key === "manager_name") managerGroups[index].name = value
      if (key === "manager_phone") managerGroups[index].phone = value
      if (key === "manager_mail") managerGroups[index].mail = value
      return
    }

    switch (key) {
      case "inn":
        supplierFormData.inn = value.replace(/\D/g, "")
        break
      case "name":
      case "comment":
      case "kp_url":
        supplierFormData[key] = value
        break
      case "is_smsp":
        supplierFormData.is_smsp = value === "+" ? true : value === "-" ? false : null
        break
      case "company_number":
      case "company_mail":
      case "okved_main":
      case "okved_other":
      case "item":
      case "region":
      case "client":
        supplierFormData[key] = value
          ? value
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v)
          : []
        break
      default:
        supplierFormData[key] = value
    }
  })

  supplierFormData.managers = Object.values(managerGroups).filter(
    (manager) => manager.name || manager.phone || manager.mail
  )
}

function collectSearchData() {
  const form = document.querySelector(".find-supplier")
  const inputs = form.querySelectorAll("input")
  const arrayFields = [
    "find",
    "find_main_okved",
    "find_other_okved",
    "find_item",
    "find_region",
    "find_client"
  ]
  searchData = {}

  inputs.forEach((input) => {
    const key = input.name
    const value = input.value.trim()
    if (!key || value === "") return

    if (arrayFields.includes(key)) {
      searchData[key] = value
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v !== "")
    } else {
      searchData[key] = value.toLowerCase()
    }
  })
}

window.switchTab = switchTab
window.handleAuth = handleAuth

function renderPagination(container, totalPages, currentPage, mode) {
  if (totalPages <= 1) return

  const pagination = document.createElement("div")
  pagination.className = "supplier-pagination"

  const prevBtn = document.createElement("button")
  prevBtn.className = "supplier-pagination__btn"
  prevBtn.innerText = "←"
  prevBtn.disabled = currentPage <= 1
  prevBtn.addEventListener("click", function () {
    if (mode === "find") findCurrentPage = Math.max(1, findCurrentPage - 1)
    else lkCurrentPage = Math.max(1, lkCurrentPage - 1)
    renderSuppliers()
  })
  pagination.appendChild(prevBtn)

  const maxVisible = 7
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2))
  let end = Math.min(totalPages, start + maxVisible - 1)
  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1)
  }

  for (let page = start; page <= end; page++) {
    const pageBtn = document.createElement("button")
    pageBtn.className = "supplier-pagination__btn"
    if (page === currentPage) pageBtn.classList.add("is-active")
    pageBtn.innerText = String(page)
    pageBtn.addEventListener("click", function () {
      if (mode === "find") findCurrentPage = page
      else lkCurrentPage = page
      renderSuppliers()
    })
    pagination.appendChild(pageBtn)
  }

  const nextBtn = document.createElement("button")
  nextBtn.className = "supplier-pagination__btn"
  nextBtn.innerText = "→"
  nextBtn.disabled = currentPage >= totalPages
  nextBtn.addEventListener("click", function () {
    if (mode === "find") findCurrentPage = Math.min(totalPages, findCurrentPage + 1)
    else lkCurrentPage = Math.min(totalPages, lkCurrentPage + 1)
    renderSuppliers()
  })
  pagination.appendChild(nextBtn)

  container.appendChild(pagination)
}

function bindDeleteButtons(container) {
  const deleteButtons = container.querySelectorAll(".supplier-delete-btn")
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", async function () {
      this.closest(".supplier-table__row")?.classList.add("supplier-table__row--no-open")
      const supplierId = this.getAttribute("data-supplier-id")
      if (!supplierId) return

      const userConfirmed = await showAppConfirm("Удалить поставщика?")
      if (!userConfirmed) return

      const supplier = allSuppliers.find((item) => String(item.id) === String(supplierId))
      if (!supplier || supplier.created_by !== currentUser?.id) {
        await showAppAlert("Можно удалять только своих поставщиков", { type: "error" })
        return
      }

      const { error } = await client.from("suppliers").delete().eq("id", supplierId)
      if (error) {
        await showAppAlert(`Ошибка удаления: ${error.message}`, { type: "error" })
        return
      }

      await refreshSuppliers()
    })
  })
}

function bindSupplierRowOpenDetails(container, list) {
  const rowMap = new Map(list.map((supplier) => [String(supplier.id), supplier]))
  const rows = container.querySelectorAll(".supplier-table__row:not(.supplier-table__row--header)")
  rows.forEach((row) => {
    row.addEventListener("click", function (e) {
      const clickedDelete = e.target.closest(".supplier-delete-btn")
      if (clickedDelete) return

      const supplierId = row.getAttribute("data-supplier-id")
      if (!supplierId) return
      const supplier = rowMap.get(supplierId)
      if (!supplier) return
      openSupplierDetailsModal(supplier)
    })
  })
}

function openSupplierDetailsModal(supplier) {
  ensureSupplierDetailsModal()
  if (!supplierDetailsOverlay) return

  const modalBody = supplierDetailsOverlay.querySelector(".supplier-details-modal__body")
  const title = supplierDetailsOverlay.querySelector(".supplier-details-modal__title")
  if (!modalBody || !title) return

  const managersText = toArray(supplier.managers)
    .map((m) => {
      if (typeof m !== "object" || m === null) return String(m)
      const parts = [m.name, m.phone, m.mail].filter(Boolean)
      return parts.join(" | ")
    })
    .filter(Boolean)
    .join("\n")

  title.textContent = supplier.name || "Детали поставщика"
  modalBody.innerHTML = `
    ${renderDetailRow("ИНН", supplier.inn)}
    ${renderDetailRow("СМСП", supplier.is_smsp === true ? "Да (+)" : supplier.is_smsp === false ? "Нет (-)" : "Не указано")}
    ${renderDetailRow("Телефоны", toArray(supplier.company_number).join(", "))}
    ${renderDetailRow("Почты", toArray(supplier.company_mail).join(", "))}
    ${renderDetailRow("Основной ОКВЭД2", toArray(supplier.okved_main).join(", "))}
    ${renderDetailRow("Доп. ОКВЭД2", toArray(supplier.okved_other).join(", "))}
    ${renderDetailRow("Предмет закупки", toArray(supplier.item).join(", "))}
    ${renderDetailRow("Регион", toArray(supplier.region).join(", "))}
    ${renderDetailRow("Заказчики", toArray(supplier.client).join(", "))}
    ${renderDetailRow("Ответственные", managersText)}
    ${renderDetailRow("Комментарий", supplier.comment)}
    ${renderDetailRow("Ссылка на КП", supplier.kp_url)}
  `

  isSupplierModalClosing = false
  supplierDetailsOverlay.classList.remove("hidden")
  // Форсируем reflow, чтобы сработал transition от начального состояния
  void supplierDetailsOverlay.offsetWidth
  supplierDetailsOverlay.classList.add("is-visible")
  document.body.classList.add("modal-open")

}

function closeSupplierDetailsModal() {
  if (!supplierDetailsOverlay) return
  if (isSupplierModalClosing || supplierDetailsOverlay.classList.contains("hidden")) return
  isSupplierModalClosing = true
  supplierDetailsOverlay.classList.remove("is-visible")

  const onTransitionEnd = () => {
    supplierDetailsOverlay.classList.add("hidden")
    supplierDetailsOverlay.removeEventListener("transitionend", onTransitionEnd)
    isSupplierModalClosing = false
  }
  supplierDetailsOverlay.addEventListener("transitionend", onTransitionEnd)
  document.body.classList.remove("modal-open")
}

function ensureSupplierDetailsModal() {
  if (supplierDetailsOverlay) return
  supplierDetailsOverlay = document.createElement("div")
  supplierDetailsOverlay.className = "supplier-details-overlay hidden"
  supplierDetailsOverlay.innerHTML = `
    <div class="supplier-details-modal">
      <div class="supplier-details-modal__header">
        <p class="supplier-details-modal__title"></p>
        <button class="supplier-details-modal__close" aria-label="Закрыть">✕</button>
      </div>
      <div class="supplier-details-modal__body"></div>
    </div>
  `
  document.body.appendChild(supplierDetailsOverlay)

  const closeBtn = supplierDetailsOverlay.querySelector(".supplier-details-modal__close")
  closeBtn?.addEventListener("click", closeSupplierDetailsModal)

  supplierDetailsOverlay.addEventListener("click", function (e) {
    if (e.target === supplierDetailsOverlay) closeSupplierDetailsModal()
  })

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSupplierDetailsModal()
  })
}

function renderDetailRow(label, value) {
  const text = value && String(value).trim() ? String(value) : "-"
  return `
    <div class="supplier-details-modal__row">
      <p class="supplier-details-modal__label">${escapeHtml(label)}</p>
      <p class="supplier-details-modal__value">${escapeHtml(text).replaceAll("\n", "<br>")}</p>
    </div>
  `
}

async function checkSupplierInnExists(inn) {
  const { data, error } = await client
    .from("suppliers")
    .select("id")
    .eq("inn", inn)
    .limit(1)

  if (error) {
    console.error("Ошибка проверки дубля ИНН:", error)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

function validateSupplierData(data) {
  if (!data.inn) return "ИНН обязателен"
  if (!/^\d{10}(\d{2})?$/.test(data.inn)) {
    return "ИНН должен содержать 10 или 12 цифр"
  }

  if (
    data.is_smsp !== null &&
    data.is_smsp !== true &&
    data.is_smsp !== false &&
    data.is_smsp !== undefined
  ) {
    return "Поле СМСП должно быть '+' или '-'"
  }

  const invalidPhone = toArray(data.company_number).some((phone) => {
    const normalized = String(phone).replace(/[^\d+]/g, "")
    return normalized.length < 6
  })
  if (invalidPhone) return "Проверьте формат телефона компании"

  const invalidEmail = toArray(data.company_mail).some((mail) => {
    return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(mail).toLowerCase())
  })
  if (invalidEmail) return "Проверьте формат почты компании"

  return null
}

function getSuppliersCacheKey() {
  const userId = currentUser?.id || "guest"
  return `suppliers_cache_${userId}`
}

function getSuppliersCacheTsKey() {
  const userId = currentUser?.id || "guest"
  return `suppliers_cache_ts_${userId}`
}

function cacheSuppliers(suppliers) {
  try {
    localStorage.setItem(getSuppliersCacheKey(), JSON.stringify(suppliers))
    localStorage.setItem(getSuppliersCacheTsKey(), String(Date.now()))
  } catch (e) {
    console.warn("Не удалось сохранить кэш suppliers:", e)
  }
}

function applySuppliersFromCache() {
  try {
    const raw = localStorage.getItem(getSuppliersCacheKey())
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return

    allSuppliers = parsed
    renderSuppliers()
  } catch (e) {
    console.warn("Не удалось прочитать кэш suppliers:", e)
  }
}

function showSuppliersLoadingState() {
  if (findOutputTitle) findOutputTitle.textContent = "Обновление списка из БД..."
  if (lkOutputTitle) lkOutputTitle.textContent = "Обновление списка из БД..."
  if (findOutputList) findOutputList.innerHTML = ""
  if (lkOutputList) lkOutputList.innerHTML = ""
  setSuppliersRefreshing(true)
}

function createRefreshSpinner() {
  const spinner = document.createElement("span")
  spinner.className = "suppliers-refresh-spinner hidden"
  spinner.setAttribute("aria-label", "Обновление списка поставщиков")
  spinner.title = "Обновление из БД..."
  return spinner
}

function setSuppliersRefreshing(value) {
  isSuppliersRefreshing = value
  updateRefreshIndicators()
}

function updateRefreshIndicators() {
  attachSpinnerToTitle(findOutputTitle, findRefreshSpinner, isSuppliersRefreshing)
  attachSpinnerToTitle(lkOutputTitle, lkRefreshSpinner, isSuppliersRefreshing)
}

function attachSpinnerToTitle(titleNode, spinnerNode, shouldShow) {
  if (!titleNode || !spinnerNode) return
  if (spinnerNode.parentElement !== titleNode) titleNode.appendChild(spinnerNode)
  spinnerNode.classList.toggle("hidden", !shouldShow)
}

function setAuthButtonLoading(loading) {
  const actionBtn = document.getElementById("actionBtn")
  if (!actionBtn) return
  if (loading) {
    actionBtn.innerText = "Загрузка..."
    actionBtn.disabled = true
    return
  }
  actionBtn.disabled = false
  actionBtn.innerText = currentMode === "login" ? "Войти" : "Зарегистрироваться"
}

function getInnFromInput() {
  return String(addInnInput?.value || "").replace(/\D/g, "")
}

function isValidInn(inn) {
  return /^\d{10}(\d{2})?$/.test(String(inn || ""))
}

function updateInnAutofillButtonState() {
  if (!addAutofillBtn) return
  if (isInnAutofillLoading) {
    addAutofillBtn.innerText = "Загрузка..."
    addAutofillBtn.disabled = true
    return
  }

  addAutofillBtn.innerText = "Заполнить автоматически"
  const canUse = Boolean(currentUser) && isValidInn(getInnFromInput())
  addAutofillBtn.disabled = !canUse
}

async function autofillSupplierByInn() {
  if (isInnAutofillLoading) return
  if (!currentUser) {
    await showAppAlert("Сначала войдите в систему", { type: "error" })
    showPopup()
    return
  }

  const inn = getInnFromInput()
  if (!isValidInn(inn)) {
    await showAppAlert("Введите корректный ИНН (10 или 12 цифр)", { type: "error" })
    return
  }

  isInnAutofillLoading = true
  updateInnAutofillButtonState()

  try {
    const {
      data: { session }
    } = await client.auth.getSession()
    const accessToken = session?.access_token
    if (!accessToken) {
      await showAppAlert("Сессия истекла. Войдите заново", { type: "error" })
      showPopup()
      return
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/dadata-by-inn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ inn })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const message = payload?.error || `HTTP ${response.status}`
      throw new Error(message)
    }

    if (!payload?.data) {
      await showAppAlert("Организация по этому ИНН не найдена", { type: "info" })
      return
    }

    applyInnAutofillData(payload.data)
    await showAppAlert("Данные заполнены автоматически", { type: "success" })
  } catch (err) {
    console.error("Ошибка автозаполнения по ИНН:", err)
    await showAppAlert(`Не удалось получить данные: ${err.message || "неизвестная ошибка"}`, {
      type: "error"
    })
  } finally {
    isInnAutofillLoading = false
    updateInnAutofillButtonState()
  }
}

function setAddFormFieldValue(fieldName, value) {
  const field = document.querySelector(`.add-form-input[name="${fieldName}"]`)
  if (!field) return
  field.value = value == null ? "" : String(value)
}

function applyInnAutofillData(data) {
  const phones = Array.isArray(data.company_number) ? data.company_number.join(", ") : ""
  const mails = Array.isArray(data.company_mail) ? data.company_mail.join(", ") : ""
  const regions = Array.isArray(data.region) ? data.region.join(", ") : ""
  const okvedOther = Array.isArray(data.okved_other) ? data.okved_other.join(", ") : ""

  setAddFormFieldValue("name", data.name || "")
  setAddFormFieldValue("company_number", phones)
  setAddFormFieldValue("company_mail", mails)
  setAddFormFieldValue("okved_main", data.okved_main || "")
  setAddFormFieldValue("okved_other", okvedOther)
  setAddFormFieldValue("region", regions)
}

function ensureAppAlertModal() {
  if (appAlertOverlay) return

  appAlertOverlay = document.createElement("div")
  appAlertOverlay.className = "app-alert-overlay hidden"
  appAlertOverlay.innerHTML = `
    <div class="app-alert-modal">
      <div class="app-alert-modal__header">
        <p class="app-alert-modal__title">Сообщение</p>
      </div>
      <div class="app-alert-modal__body">
        <p class="app-alert-modal__message"></p>
      </div>
      <div class="app-alert-modal__actions">
        <button class="app-alert-modal__btn app-alert-modal__btn--cancel">Отмена</button>
        <button class="app-alert-modal__btn app-alert-modal__btn--confirm main-btn-style">Понятно</button>
      </div>
    </div>
  `

  document.body.appendChild(appAlertOverlay)

  const confirmBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--confirm")
  const cancelBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--cancel")
  confirmBtn?.addEventListener("click", function () {
    closeAppAlert(true)
  })
  cancelBtn?.addEventListener("click", function () {
    closeAppAlert(false)
  })

  appAlertOverlay.addEventListener("click", function (e) {
    if (e.target !== appAlertOverlay) return
    if (appAlertMode === "confirm") closeAppAlert(false)
    else closeAppAlert(true)
  })
}

function closeAppAlert(result = true) {
  if (!appAlertOverlay || appAlertOverlay.classList.contains("hidden")) return
  appAlertOverlay.classList.add("hidden")
  appAlertMode = "alert"
  if (!supplierDetailsOverlay || supplierDetailsOverlay.classList.contains("hidden")) {
    document.body.classList.remove("modal-open")
  }
  if (appAlertResolve) {
    appAlertResolve(result)
    appAlertResolve = null
  }
}

function showAppAlert(message, options = {}) {
  ensureAppAlertModal()
  if (!appAlertOverlay) return Promise.resolve()

  const { type = "info" } = options
  const titleMap = {
    success: "Успешно",
    error: "Ошибка",
    info: "Сообщение"
  }

  const titleNode = appAlertOverlay.querySelector(".app-alert-modal__title")
  const messageNode = appAlertOverlay.querySelector(".app-alert-modal__message")
  const confirmBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--confirm")
  const cancelBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--cancel")
  if (titleNode) titleNode.textContent = titleMap[type] || titleMap.info
  if (messageNode) messageNode.textContent = String(message ?? "")
  if (confirmBtn) confirmBtn.textContent = "Понятно"
  if (cancelBtn) cancelBtn.classList.add("hidden")

  appAlertOverlay.classList.remove("is-success", "is-error", "is-info")
  appAlertOverlay.classList.add(`is-${type}`)
  appAlertOverlay.classList.remove("hidden")
  appAlertMode = "alert"
  document.body.classList.add("modal-open")

  return new Promise((resolve) => {
    appAlertResolve = resolve
  })
}

function showAppConfirm(message, options = {}) {
  ensureAppAlertModal()
  if (!appAlertOverlay) return Promise.resolve(false)

  const { title = "Подтверждение", confirmText = "Удалить", cancelText = "Отмена" } = options
  const titleNode = appAlertOverlay.querySelector(".app-alert-modal__title")
  const messageNode = appAlertOverlay.querySelector(".app-alert-modal__message")
  const confirmBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--confirm")
  const cancelBtn = appAlertOverlay.querySelector(".app-alert-modal__btn--cancel")

  if (titleNode) titleNode.textContent = title
  if (messageNode) messageNode.textContent = String(message ?? "")
  if (confirmBtn) confirmBtn.textContent = confirmText
  if (cancelBtn) {
    cancelBtn.textContent = cancelText
    cancelBtn.classList.remove("hidden")
  }

  appAlertOverlay.classList.remove("is-success", "is-error", "is-info")
  appAlertOverlay.classList.add("is-info")
  appAlertOverlay.classList.remove("hidden")
  appAlertMode = "confirm"
  document.body.classList.add("modal-open")

  return new Promise((resolve) => {
    appAlertResolve = resolve
  })
}
