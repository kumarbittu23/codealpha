function validateProfile(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (name.length < 2 || name.length > 80) return { error: "Name must be between 2 and 80 characters." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
    return { error: "New password must be between 8 and 128 characters." };
  }
  return { value: { name, email, currentPassword, newPassword } };
}

function validateAddress(body) {
  const { recipientName, phone, line1, line2, city, state, postalCode } = body;
  if ([recipientName, line1, city, state, postalCode].some((value) => typeof value !== "string")) {
    return { error: "Complete all required address fields." };
  }
  const address = {
    recipientName: recipientName.trim(),
    phone: typeof phone === "string" ? phone.replace(/\D/g, "") : "",
    line1: line1.trim(),
    line2: typeof line2 === "string" ? line2.trim() : "",
    city: city.trim(),
    state: state.trim(),
    postalCode: postalCode.trim()
  };
  if (address.recipientName.length < 2 || address.recipientName.length > 100 ||
      address.line1.length < 3 || address.line1.length > 150 ||
      address.line2.length > 150 || address.city.length < 2 || address.city.length > 80 ||
      address.state.length < 2 || address.state.length > 80 ||
      !/^[1-9]\d{5}$/.test(address.postalCode) || !/^[6-9]\d{9}$/.test(address.phone)) {
    return { error: "Enter a valid Indian mobile number, six-digit PIN code, and complete address." };
  }
  return { value: address };
}

module.exports = { validateProfile, validateAddress };
