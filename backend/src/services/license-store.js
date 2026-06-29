let activatedLicense = null;

export const saveActivatedLicense = async ({
  license,
  licenseKey,
  licenseKeyHash,
}) => {
  activatedLicense = {
    license,
    licenseKey,
    licenseKeyHash,
    activatedAt: new Date().toISOString(),
  };

  return activatedLicense;
};

export const getActivatedLicense = async () => activatedLicense;