const bcrypt = require("bcryptjs");
const accountRepository = require("../repositories/account.repository");
const accountService = require("../services/account.service");
const { publicUser } = require("../services/marketplace.shared");

function createAccountController() {
  return {
    listOrders(request, response) {
      response.json(accountRepository.listOrders(request.session.user.id));
    },
    updateProfile: async (request, response, next) => {
      const result = accountService.validateProfile(request.body);
      if (result.error) return response.status(400).json({ error: result.error });
      const { name, email, currentPassword, newPassword } = result.value;
      const userId = request.session.user.id;
      const storedUser = accountRepository.findPasswordHash(userId);
      if (newPassword || email !== request.session.user.email) {
        if (!currentPassword || !storedUser || !await bcrypt.compare(currentPassword, storedUser.password_hash)) {
          return response.status(403).json({ error: "Enter your current password to change your email or password." });
        }
      }
      try {
        const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : storedUser.password_hash;
        accountRepository.updateProfile(userId, { name, email, passwordHash });
        request.session.user.name = name;
        request.session.user.email = email;
        response.json({ user: publicUser(request.session.user) });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
          return response.status(409).json({ error: "That email address is already used by another account." });
        }
        next(error);
      }
    },
    getRewards(request, response) {
      const totals = accountRepository.getRewardTotals(request.session.user.id);
      response.json({
        points: Math.floor(totals.deliveredTotalPaise / 10000),
        deliveredOrderCount: totals.deliveredOrderCount,
        walletBalancePaise: 0,
        walletEnabled: false,
        pointsPerHundredRupees: 1
      });
    },
    listAddresses(request, response) {
      response.json(accountRepository.listAddresses(request.session.user.id));
    },
    createAddress(request, response) {
      const result = accountService.validateAddress(request.body);
      if (result.error) return response.status(400).json({ error: result.error });
      const userId = request.session.user.id;
      const isDefault = request.body.isDefault === true || accountRepository.listAddresses(userId).length === 0;
      response.status(201).json(accountRepository.createAddress(userId, result.value, isDefault));
    },
    deleteAddress(request, response) {
      const id = Number(request.params.id);
      if (!accountRepository.deleteAddress(request.session.user.id, id)) {
        return response.status(404).json({ error: "Address not found." });
      }
      response.status(204).end();
    },
    listWishlist(request, response) {
      response.json(accountRepository.listWishlist(request.session.user.id));
    },
    addWishlistItem(request, response) {
      const productId = Number(request.params.productId);
      if (!accountRepository.isWishlistProductAvailable(productId)) {
        return response.status(404).json({ error: "Product not found." });
      }
      accountRepository.addToWishlist(request.session.user.id, productId);
      response.status(201).json({ success: true });
    },
    removeWishlistItem(request, response) {
      accountRepository.removeFromWishlist(request.session.user.id, Number(request.params.productId));
      response.status(204).end();
    }
  };
}

module.exports = createAccountController;
