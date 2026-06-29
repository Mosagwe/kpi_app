import {
  createLicenseValidator,
  decodeBase64PublicKey,
} from "@licence-generator/license-validator";
import { PRODUCT_IDENTITY } from "./config/product-identity.js";

export function createConfiguredLicenseValidator(env = process.env) {
  return createLicenseValidator({
    publicKey: decodeBase64PublicKey(env.LICENSE_PUBLIC_KEY),
    identity: {
      ...PRODUCT_IDENTITY,
      environment:
        env.LICENSE_ENVIRONMENT || env.NODE_ENV || "development",
    },
  });
}

export const licenseValidator = {
  validateKey: (licenseKey, options) =>
    createConfiguredLicenseValidator().validateKey(licenseKey, options),
  validateLicense: (license, options) =>
    createConfiguredLicenseValidator().validateLicense(license, options),
  verifyKey: (licenseKey) =>
    createConfiguredLicenseValidator().verifyKey(licenseKey),
  hashKey: (licenseKey) =>
    createConfiguredLicenseValidator().hashKey(licenseKey),
};
