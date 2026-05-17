const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("message");
const statusBox = document.getElementById("status");

async function sendWebhook() {
  const webhook = document.getElementById("webhook").value.trim();
  const username = document.getElementById("username").value.trim();
  const avatar = document.getElementById("avatar").value.trim();
  const message = messageInput.value.trim();

  if (!webhook || !message) {
    statusBox.innerText = "Webhook URL and message are required.";
    return;
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: username || undefined,
        avatar_url: avatar || undefined,
        content: message
      })
    });

    if (response.ok) {
      statusBox.innerText = "Message sent successfully.";
      messageInput.value = "";
      messageInput.placeholder = "Send: ";
      messageInput.focus();
    } else {
      statusBox.innerText = "Failed to send webhook.";
    }
  } catch (error) {
    statusBox.innerText = "Error: " + error.message;
  }
}

sendBtn.addEventListener("click", sendWebhook);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendWebhook();
  }
});