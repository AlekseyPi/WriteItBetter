let popupAbortController = null;

window.addEventListener("load", async () => {
  const darkMode = await getDarkMode();
  if (darkMode) {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
  initConfigPopup();

  const aiPromptTextArea = await initInputStorage("aiPromptTextArea");
  const input = await initInputStorage("inputTextArea");
  await initInputStorage("aiOutputTextArea");

  const submitButton = document.getElementById("submitButton");
  submitButton.addEventListener("click", submitButtonClick);

  input.addEventListener("input", cleanupAiSuggestion);
  aiPromptTextArea.addEventListener("input", cleanupAiSuggestion);
  enableAutoComplete(
    aiPromptTextArea,
    darkMode,
    getAIPromptHistory,
    deleteMRUItem
  );

  input.focus();
  input.select();

  initPreviewIcon(input);
  const aiModelSelect = document.getElementById("aiModelSelect");
  await initAIModelSelect(aiModelSelect);
});

async function initAIModelSelect(aiModelSelect) {
  while (aiModelSelect.firstChild) {
    aiModelSelect.removeChild(aiModelSelect.firstChild);
  }
  const userConfigAiModel = (await getAiModelName()) ?? defaultAIModelName;
  const models = [userConfigAiModel].concat(
    aiModelList.filter((x) => x !== userConfigAiModel)
  );
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.text = model;
    aiModelSelect.appendChild(option);
  });
}

function initPreviewIcon(input) {
  input.addEventListener("paste", async function (event) {
    const items = (event.clipboardData || event.originalEvent.clipboardData)
      .items;
    for (index in items) {
      const item = items[index];
      if (item.kind === "file" && item.type.match(/^image\//)) {
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = function (event) {
          const base64Image = event.target.result;
          const imagePreviewIcon = document.getElementById("imagePreviewIcon");
          imagePreviewIcon.src = base64Image;
          imagePreviewIcon.style.display = "block";
        };
        reader.readAsDataURL(blob);
      }
    }
  });
}

async function cleanupAiSuggestion() {
  const aiOutputTextArea = document.getElementById("aiOutputTextArea");
  aiOutputTextArea.value = "";
  await storeInputValue(aiOutputTextArea);
}

async function log(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  await new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { action: "log", payload: message },
      resolve
    );
  });
}

async function initInputStorage(inputElementId) {
  const input = document.getElementById(inputElementId);
  const inputKey = `popupState.${inputElementId}`;
  input.value = (await getStorage(inputKey)) ?? "";
  input.addEventListener("input", () => storeInputValue(input));
  return input;
}

async function storeInputValue(input) {
  const inputElementId = input.id;
  const inputKey = `popupState.${inputElementId}`;
  await setStorage(inputKey, input.value);
}

async function submitButtonClick(event) {
  const submitButton = event.target;
  if (popupAbortController !== null) {
    submitButton.textContent = "Submit";
    popupAbortController.abort();
    popupAbortController = null;
    return;
  }
  submitButton.textContent = "Cancel";

  const openaiSecretKey = await getOpenAiSecretKey();
  const aiPromptTextArea = document.getElementById("aiPromptTextArea");
  const inputTextArea = document.getElementById("inputTextArea");
  const aiOutputTextArea = document.getElementById("aiOutputTextArea");

  await storeInputValue(aiPromptTextArea);
  await storeAIPromptToMRU(aiPromptTextArea.value);
  await cleanupAiSuggestion();
  const contextString = inputTextArea.value;
  const prompt = aiPromptTextArea.value;
  const promptColon = prompt === "" || prompt.endsWith(":") ? "" : ":";
  const aiQuery = `${prompt + promptColon} ${contextString}`;
  const temperature = document.getElementById("temperatureInput").value / 10;
  const maxTokens = await getAiMaxAITokens();

  const imagePreviewIcon = document.getElementById("imagePreviewIcon");
  const imageContentBase64 = imagePreviewIcon.src;

  await log(aiQuery);
  await log(imageContentBase64);
  popupAbortController = new AbortController();

  const aiModel = document.getElementById("aiModelSelect").value;

  await streamAnswer(
    popupAbortController,
    openaiSecretKey,
    aiQuery,
    imageContentBase64,
    temperature,
    maxTokens,
    (partialResponse) => {
      aiOutputTextArea.value += partialResponse;
    },
    async (error) => {
      aiOutputTextArea.value +=
        "/n/nError occurred while streaming the answer: " + error;
      await log(error);
      popupAbortController = null;
    },
    aiModel
  );
  await storeInputValue(aiOutputTextArea);
  aiOutputTextArea.focus();
  aiOutputTextArea.select();
  popupAbortController = null;

  submitButton.textContent = "Submit";
}

function initConfigPopup() {
  const configButton = document.getElementById("configButton");
  const configPopup = document.getElementById("configPopup");
  const configForm = document.getElementById("configForm");
  const configDefaultAIModelSelect = document.getElementById(
    "configDefaultAIModelSelect"
  );
  const aiMaxAITokensInput = document.getElementById("aiMaxAITokens");
  const darkModeInput = document.getElementById("darkModeInput");
  const openAIKeyInput = document.getElementById("openAIKey");
  const cancelButton = document.getElementById("cancelButton");

  configButton.addEventListener("click", showConfigPopup);
  configForm.addEventListener("submit", updateConfig);
  cancelButton.addEventListener("click", hideConfigPopup);
  document.addEventListener("click", documentClickHidesConfigPopup);

  function documentClickHidesConfigPopup(event) {
    var isClickOutsidePopup = !configForm.contains(event.target);
    if (isClickOutsidePopup) {
      hideConfigPopup();
    }
  }

  async function showConfigPopup() {
    const configDefaultAIModelSelect = document.getElementById(
      "configDefaultAIModelSelect"
    );
    await initAIModelSelect(configDefaultAIModelSelect);

    aiMaxAITokensInput.value = await getAiMaxAITokens();
    darkModeInput.checked = await getDarkMode();
    openAIKeyInput.value = "";
    configPopup.style.display = "flex";
  }

  async function updateConfig(e) {
    e.preventDefault();
    await setAiModelName(configDefaultAIModelSelect.value);
    await setAiMaxAITokens(aiMaxAITokensInput.value);
    await setDarkMode(darkModeInput.checked);

    const darkMode = await getDarkMode();
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }

    if (openAIKeyInput.value !== "") {
      await setOpenAiSecretKey(openAIKeyInput.value);
    }
    hideConfigPopup();
  }

  function hideConfigPopup() {
    configPopup.style.display = "none";
  }
}
