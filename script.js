/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsListEl = document.getElementById("selectedProductsList");
const generateBtn = document.getElementById("generateRoutine");

// new: search input + in-memory product cache
const productSearch = document.getElementById("productSearch");
let allProducts = [];

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* initialize product cache once */
(async function initProductCache() {
  try {
    allProducts = await loadProducts();
  } catch (err) {
    // keep graceful fallback
    console.error("Failed to load products:", err);
  }
})();

/* Apply combined filters (category + search) and display results */
async function applyFilters() {
  // ensure products are loaded
  if (allProducts.length === 0) {
    allProducts = await loadProducts();
  }

  const category = categoryFilter.value;
  const q = (productSearch?.value || "").trim().toLowerCase();

  let filtered = allProducts;

  // filter by category if selected
  if (category) {
    filtered = filtered.filter((p) => p.category === category);
  }

  // filter by search term across name, brand, description
  if (q) {
    filtered = filtered.filter((p) => {
      const hay = `${p.name} ${p.brand || ""} ${
        p.description || ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }

  displayProducts(filtered);
  updateSelectedProductsList();
}

/* Replace previous category-only listener: use combined filter instead */
categoryFilter.addEventListener("change", () => {
  applyFilters();
});

/* Debounce helper so search doesn't trigger too many renders */
function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* Wire search input to apply filters as the user types */
if (productSearch) {
  productSearch.addEventListener(
    "input",
    debounce(() => applyFilters(), 160)
  );
}

/* track selected products (key -> product object) */
const selectedProducts = new Map();

/* conversation history for follow-up questions (keeps full chat) */
const conversationMessages = [
  {
    role: "system",
    content:
      "You are a helpful skincare and beauty routine assistant. Answer only about skincare, haircare, makeup, fragrance, and routine-related follow-ups. " +
      "If asked something unrelated, reply: 'I can only help with routines and beauty topics — please ask something related.' Keep answers concise and user friendly.",
  },
];

/* Create HTML for displaying product cards
   - include data attributes so we can toggle selection
   - show an info button and description block (if available) */
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((product) => {
      const key = encodeURIComponent(product.name);
      const isSelected = selectedProducts.has(key) ? "selected" : "";
      return `
    <div class="product-card ${isSelected}" 
         data-key="${key}" 
         data-name="${product.name}" 
         data-brand="${product.brand}" 
         data-image="${product.image}"
         data-description="${(product.description || "").replace(
           /"/g,
           "&quot;"
         )}">
      <button class="info-btn" aria-label="Toggle description" title="Toggle description">
        <i class="fa-solid fa-info"></i>
      </button>
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
        <div class="product-desc" aria-hidden="true">${
          product.description || ""
        }</div>
      </div>
    </div>
  `;
    })
    .join("");
}

/* Update the Selected Products list UI */
function updateSelectedProductsList() {
  if (!selectedProductsListEl) return;
  const html = Array.from(selectedProducts.values())
    .map(
      (p) => `
    <div class="selected-item" data-key="${encodeURIComponent(p.name)}">
      <img src="${p.image}" alt="${p.name}" />
      <div class="selected-info">
        <strong>${p.name}</strong>
        <div class="small-brand">${p.brand}</div>
      </div>
      <button class="remove-btn" aria-label="Remove ${p.name}">&times;</button>
    </div>`
    )
    .join("");
  selectedProductsListEl.innerHTML =
    html || `<div class="placeholder-message">No products selected</div>`;
}

/* Toggle description or selection via event delegation */
productsContainer.addEventListener("click", (e) => {
  const infoBtn = e.target.closest(".info-btn");
  if (infoBtn) {
    e.stopPropagation();
    const card = infoBtn.closest(".product-card");
    if (!card) return;
    const desc = card.querySelector(".product-desc");
    const expanded = card.classList.toggle("expanded");
    if (desc) desc.setAttribute("aria-hidden", String(!expanded));
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) return;

  const key = card.dataset.key;
  const name = card.dataset.name;
  const brand = card.dataset.brand;
  const image = card.dataset.image;

  if (!key) return;

  if (selectedProducts.has(key)) {
    selectedProducts.delete(key);
    card.classList.remove("selected");
  } else {
    selectedProducts.set(key, { name, brand, image });
    card.classList.add("selected");
  }

  updateSelectedProductsList();
});

/* Removing from selected list */
if (selectedProductsListEl) {
  selectedProductsListEl.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".remove-btn");
    if (!removeBtn) return;
    const item = e.target.closest(".selected-item");
    if (!item) return;
    const key = item.dataset.key;
    if (!key) return;
    selectedProducts.delete(key);
    updateSelectedProductsList();
    const card = productsContainer.querySelector(
      `.product-card[data-key="${key}"]`
    );
    if (card) card.classList.remove("selected");
  });
}

/* Chat form submission handler - sends follow-up questions to OpenAI using full conversation history */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  // show user's message in chat window
  const userMsgEl = document.createElement("div");
  userMsgEl.className = "chat-user";
  userMsgEl.textContent = text;
  chatWindow.appendChild(userMsgEl);
  input.value = "";
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // add user's question to conversation history
  conversationMessages.push({ role: "user", content: text });

  // require API key
  const apiKey = window.OPENAI_API_KEY;
  if (!apiKey) {
    appendAssistantMessage(
      "OpenAI API key not found. Add your key to secrets.js and reload the page."
    );
    return;
  }

  // call OpenAI with the full conversation
  try {
    appendAssistantMessage("Thinking…");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: conversationMessages,
        max_tokens: 500,
        temperature: 0.8,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      appendAssistantMessage(`Error from OpenAI: ${resp.status} ${errText}`);
      return;
    }

    const data = await resp.json();
    const assistantContent = data?.choices?.[0]?.message?.content;
    if (assistantContent) {
      // append nicely formatted assistant reply and store it in history
      appendAssistantMessage(assistantContent);
      conversationMessages.push({
        role: "assistant",
        content: assistantContent,
      });
    } else {
      appendAssistantMessage("No response from the API. Try again later.");
    }
  } catch (err) {
    appendAssistantMessage(`Request failed: ${err.message}`);
  }
});

/* Helper: parse assistant text into DOM nodes (headings, paragraphs, ordered lists, unordered lists)
   - handles headings that end with ":" on their own line
   - supports numbered lists, bullet lists, and line continuations for items
   - keeps output as real DOM nodes for styling */
function parseAssistantTextToNodes(text) {
  const nodes = [];
  if (!text) return nodes;

  const normalized = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  paragraphs.forEach((para) => {
    const lines = para
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Heading case: first line ends with ":" and there are more lines after it
    if (lines.length > 1 && /:\s*$/.test(lines[0])) {
      const heading = document.createElement("h4");
      heading.textContent = lines[0].replace(/:\s*$/, "");
      heading.className = "assistant-heading";
      nodes.push(heading);

      // treat rest of the lines as a small block (list or paragraph)
      const rest = lines.slice(1).join("\n");
      const childNodes = parseAssistantTextToNodes(rest);
      childNodes.forEach((n) => nodes.push(n));
      return;
    }

    // Detect pure numbered list (lines starting with "1.", "2)", etc.)
    const isNumbered =
      lines.filter((l) => /^\s*\d+[\.\)]\s+/.test(l)).length >= 1;
    const isBullet = lines.filter((l) => /^\s*[-*•]\s+/.test(l)).length >= 1;

    if (isNumbered && !isBullet) {
      const ol = document.createElement("ol");
      lines.forEach((line) => {
        if (/^\s*\d+[\.\)]\s+/.test(line)) {
          // new list item
          const text = line.replace(/^\s*\d+[\.\)]\s+/, "").trim();
          const li = document.createElement("li");
          li.textContent = text;
          ol.appendChild(li);
        } else {
          // continuation text: append to last li
          const last = ol.lastElementChild;
          if (last) last.textContent += " " + line;
        }
      });
      nodes.push(ol);
      return;
    }

    if (isBullet && !isNumbered) {
      const ul = document.createElement("ul");
      lines.forEach((line) => {
        if (/^\s*[-*•]\s+/.test(line)) {
          const text = line.replace(/^\s*[-*•]\s+/, "").trim();
          const li = document.createElement("li");
          li.textContent = text;
          ul.appendChild(li);
        } else {
          const last = ul.lastElementChild;
          if (last) last.textContent += " " + line;
        }
      });
      nodes.push(ul);
      return;
    }

    // Mixed or fallback: if a paragraph contains many short lines that look like steps (e.g., "Step 1:")
    const stepCount = lines.filter((l) =>
      /^\s*Step\s*\d+[:\.\)]\s*/i.test(l)
    ).length;
    if (stepCount >= 2) {
      const ol = document.createElement("ol");
      lines.forEach((line) => {
        if (/^\s*Step\s*\d+[:\.\)]\s*/i.test(line)) {
          const text = line.replace(/^\s*Step\s*\d+[:\.\)]\s*/i, "").trim();
          const li = document.createElement("li");
          li.textContent = text;
          ol.appendChild(li);
        } else {
          const last = ol.lastElementChild;
          if (last) last.textContent += " " + line;
        }
      });
      nodes.push(ol);
      return;
    }

    // fallback: create a paragraph node (join lines with space)
    const pEl = document.createElement("p");
    pEl.textContent = lines.join(" ");
    nodes.push(pEl);
  });

  return nodes;
}

/* Helper to append assistant message to chat window (formatted) */
function appendAssistantMessage(text) {
  const container = document.createElement("div");
  container.className = "chat-assistant";

  if (text instanceof HTMLElement) {
    container.appendChild(text);
  } else {
    // parse into structured nodes and append
    const nodes = parseAssistantTextToNodes(String(text));
    if (nodes.length === 0) {
      const p = document.createElement("p");
      p.textContent = String(text);
      container.appendChild(p);
    } else {
      nodes.forEach((n) => container.appendChild(n));
    }
  }

  chatWindow.appendChild(container);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Generate Routine button handler
   - collects selected products
   - sends the user's product-list prompt as a user message in conversationMessages
   - calls OpenAI with full conversation and saves assistant reply for follow-ups */
generateBtn.addEventListener("click", async () => {
  const products = Array.from(selectedProducts.values());
  if (products.length === 0) {
    appendAssistantMessage(
      "Please select one or more products before generating a routine."
    );
    return;
  }

  // build a readable product list for the model
  const productListText = products
    .map((p, i) => `${i + 1}. ${p.name} — ${p.brand}`)
    .join("\n");

  const userPrompt =
    `I have the following selected products:\n${productListText}\n\n` +
    `Please create a personalized routine that uses these products where appropriate. ` +
    `Give step-by-step instructions (order, amount, frequency), and brief reasons for each step. ` +
    `If a product is not suitable for daily use, note that and suggest alternatives or frequency.\n\n` +
    `Return a clear, numbered routine that a user can follow.`;

  // show a brief user entry in chat so the conversation feels natural
  const userMsgEl = document.createElement("div");
  userMsgEl.className = "chat-user";
  userMsgEl.textContent = "Generate routine for selected products.";
  chatWindow.appendChild(userMsgEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // push user's routine request to conversation history
  conversationMessages.push({ role: "user", content: userPrompt });

  // get API key and call OpenAI
  const apiKey = window.OPENAI_API_KEY;
  if (!apiKey) {
    appendAssistantMessage(
      "OpenAI API key not found. Add your key to secrets.js and reload the page."
    );
    return;
  }

  try {
    appendAssistantMessage("Generating a personalized routine...");

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: conversationMessages,
        max_tokens: 700,
        temperature: 0.8,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      appendAssistantMessage(`Error from OpenAI: ${resp.status} ${errText}`);
      return;
    }

    const data = await resp.json();
    const assistantContent = data?.choices?.[0]?.message?.content;
    if (assistantContent) {
      appendAssistantMessage(assistantContent);
      // store assistant reply in the conversation history for follow-ups
      conversationMessages.push({
        role: "assistant",
        content: assistantContent,
      });
    } else {
      appendAssistantMessage("No response from the API. Try again later.");
    }
  } catch (err) {
    appendAssistantMessage(`Request failed: ${err.message}`);
  }
});

/* End of script file */
