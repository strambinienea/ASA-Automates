import jwt from 'jsonwebtoken'


/**
 * Decode Deliveroo JWT token to get agent information
 * @param {string} token - JWT token to decode
 * @returns {DecodedDeliverooJWT} Decoded token payload
 */
function decodeToken(token) {
    if ( !token ) return null;
    try {
        return jwt.decode(token);
    } catch (error) {
        throw new Error(`Failed to decode token: ${error.message}`);
    }
}

/**
 * @typedef {Object} DecodedDeliverooJWT
 * @property {string} id
 * @property {string} name
 * @property {string} teamId
 * @property {string} teamName
 * @property {string} role
 * @property {number} iat
 */

export {decodeToken}