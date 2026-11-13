// appwrite.js — Conexión con Appwrite: cuentas, sesiones y fila de progreso.
// FASE 2: registro, inicio de sesión, cierre de sesión, recuperación de sesión
// y creación del perfil con nombre de usuario único.
// (El guardado y la carga completos del progreso se implementan en la Fase 10.)
//
// SEGURIDAD:
// - Las contraseñas solo se envían a Appwrite, que las guarda con hash (Argon2).
//   Este código nunca las almacena, ni en variables globales ni en localStorage.
// - Aquí solo hay datos públicos (endpoint e IDs). NUNCA una API Key.
import { Client, Account, TablesDB, ID, Permission, Role } from 'appwrite';

// Variables de entorno definidas en .env (Vite solo expone las que empiezan por VITE_)
const ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT;
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID;
const PROGRESS_TABLE_ID = import.meta.env.VITE_APPWRITE_PROGRESS_TABLE_ID;

const client = new Client().setEndpoint(ENDPOINT || 'https://cloud.appwrite.io/v1');
if (PROJECT_ID) client.setProject(PROJECT_ID);

const account = new Account(client);
const tablesDB = new TablesDB(client);

// Formato permitido del nombre de usuario: 3-20 caracteres, letras, números y "_".
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// Tipo de error propio para distinguir "nombre ocupado" de otros conflictos 409
export const USERNAME_TAKEN = 'username_taken';

/** Indica si el archivo .env tiene todos los datos necesarios. */
export function isConfigured() {
  return Boolean(ENDPOINT && PROJECT_ID && DATABASE_ID && PROGRESS_TABLE_ID);
}

/** Validación en el cliente (solo para la experiencia de usuario: la garantía real es el índice único). */
export function validateUsername(username) {
  if (!USERNAME_REGEX.test(username)) {
    return 'El nombre debe tener entre 3 y 20 caracteres: letras, números o "_".';
  }
  return null; // null = sin errores
}

/**
 * Recupera la sesión activa (la cookie de sesión la gestiona Appwrite).
 * Devuelve el usuario o null si no hay sesión.
 */
export async function getCurrentUser() {
  try {
    return await account.get();
  } catch (error) {
    if (error.code === 401) return null; // Sin sesión: no es un error real
    throw error;
  }
}

/**
 * Registro: crea la cuenta e inicia sesión.
 * El perfil (con el nombre único) se crea después con createProfile().
 */
export async function register(email, password, username) {
  await account.create({
    userId: ID.unique(),
    email,
    password,
    name: username, // Nombre visible de la cuenta (NO garantiza unicidad)
  });
  return login(email, password);
}

/** Inicio de sesión con correo y contraseña. Devuelve el usuario. */
export async function login(email, password) {
  try {
    await account.createEmailPasswordSession({ email, password });
  } catch (error) {
    // Si ya existe una sesión activa en este navegador, la reutilizamos
    if (error.type !== 'user_session_already_exists') throw error;
  }
  return account.get();
}

/** Cierra solo la sesión actual (no las de otros dispositivos). */
export async function logout() {
  await account.deleteSession({ sessionId: 'current' });
}

/**
 * Lee la fila de progreso del usuario. Su ID es el mismo que el del usuario.
 * Devuelve null si todavía no existe (por ejemplo, si el nombre estaba ocupado al registrarse).
 */
export async function getProfile(userId) {
  try {
    const row = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: PROGRESS_TABLE_ID,
      rowId: userId,
    });
    // Comprobación defensiva: la fila debe pertenecer a este usuario
    if (row.$id !== userId || row.userId !== userId) {
      throw new Error('La fila de progreso no corresponde al usuario actual.');
    }
    return row;
  } catch (error) {
    if (error.code === 404) return null;
    throw error;
  }
}

/**
 * Crea la fila de progreso con el nombre de usuario.
 * - rowId = ID del usuario → solo puede existir una fila por usuario.
 * - usernameKey tiene un ÍNDICE ÚNICO → la base de datos rechaza duplicados (409).
 * - Permisos: solo este usuario puede leer y actualizar su fila.
 * El resto de columnas (monedas, niveles...) toman sus valores por defecto definidos en Appwrite.
 */
export async function createProfile(user, username) {
  try {
    return await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: PROGRESS_TABLE_ID,
      rowId: user.$id,
      data: {
        userId: user.$id,
        username,
        usernameKey: username.toLowerCase(), // "Juan" y "juan" se consideran el mismo nombre
      },
      permissions: [
        Permission.read(Role.user(user.$id)),
        Permission.update(Role.user(user.$id)),
      ],
    });
  } catch (error) {
    if (error.code !== 409) throw error;
    // Un 409 puede significar dos cosas:
    // 1) Ya existe la fila de este usuario → la devolvemos.
    // 2) El nombre está ocupado (índice único) → avisamos.
    const existing = await getProfile(user.$id);
    if (existing) return existing;
    const taken = new Error('Nombre de usuario ocupado');
    taken.type = USERNAME_TAKEN;
    throw taken;
  }
}

/** Traduce los errores de Appwrite a mensajes claros en español. */
export function describeError(error) {
  const messages = {
    [USERNAME_TAKEN]: 'Ese nombre de usuario ya está en uso. Elige otro.',
    user_already_exists: 'Ya existe una cuenta con ese correo.',
    user_invalid_credentials: 'Correo o contraseña incorrectos.',
    user_blocked: 'Esta cuenta está bloqueada.',
    password_personal_data: 'La contraseña no puede contener tu nombre ni tu correo.',
    general_rate_limit_exceeded: 'Demasiados intentos. Espera un momento y vuelve a probar.',
    general_argument_invalid: 'Datos no válidos. Revisa el correo y que la contraseña tenga al menos 8 caracteres.',
    project_unknown: 'El Project ID de Appwrite no es correcto. Revisa el archivo .env.',
    database_not_found: 'No se encontró la base de datos. Revisa VITE_APPWRITE_DATABASE_ID.',
    table_not_found: 'No se encontró la tabla de progreso. Revisa VITE_APPWRITE_PROGRESS_TABLE_ID.',
    user_unauthorized: 'No tienes permiso para esta operación. Revisa los permisos de la tabla.',
  };
  if (messages[error.type]) return messages[error.type];
  if (error.type === 'password_recently_used' || error.message?.toLowerCase().includes('password')) {
    return 'Contraseña no válida: usa al menos 8 caracteres y evita contraseñas comunes.';
  }
  if (error.code === 0 || error instanceof TypeError) {
    return 'No se pudo conectar con Appwrite. Revisa tu conexión y la plataforma Web (localhost).';
  }
  return `Error inesperado: ${error.message}`;
}
