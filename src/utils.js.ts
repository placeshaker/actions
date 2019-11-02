/**
 *
 * @param {*} key
 */
export const toEnvFormat = (key: string) => {
    let modified = key.toString();
    const parts = key.split(/[A-Z]/);

    parts
        .filter(p => p !== '')
        .forEach((p, index) => {
            modified = modified.replace(p, p.toUpperCase() + (index < parts.length - 1 ? '_' : ''));
        });

    return modified;
};
