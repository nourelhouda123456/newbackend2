import mongoose from 'mongoose'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import User from './models/user.js'

dotenv.config()

const SUPER_ADMIN_EMAIL    = process.env.SEED_SUPER_ADMIN_EMAIL    || 'admin@taskflow.com'
const SUPER_ADMIN_PASSWORD = process.env.SEED_SUPER_ADMIN_PASSWORD || 'admin123'
const SUPER_ADMIN_NAME     = process.env.SEED_SUPER_ADMIN_NAME     || 'administrateur'

export async function seedAdmin() {
  try {
    const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10)

    // Équivalent de prisma.upsert : where + update vide + create
    const superAdminUser = await User.findOneAndUpdate(
      { email: SUPER_ADMIN_EMAIL.toLowerCase().trim() }, // where
      {
        // $setOnInsert : ces champs ne sont appliqués QUE si le document est créé
        // → si l'utilisateur existe déjà, RIEN n'est modifié 
        $setOnInsert: {
          name:                    SUPER_ADMIN_NAME,
          email:                   SUPER_ADMIN_EMAIL.toLowerCase().trim(),
          password:                hashedPassword,
          active:                  true,
          role:                    'admin',
          doclegaux:               [],
          permit:                  false,
          permitValidationDate:    null,
        }
      },
      {
        upsert: true,       // crée le document s'il n'existe pas
        new: true,           // retourne le document (créé ou existant)
        setDefaultsOnInsert: true,
      }
    )

    console.log(`Super admin prêt → ${superAdminUser.email}`)
  } catch (err) {
    console.error('Erreur lors du seed super admin :', err.message)
  }
}

// ── Exécution autonome (node seed.js) ─────────────────────────────────────
if (process.argv[1].endsWith('seed.js')) {
  mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
      console.log('MongoDB connecté (seed)')
      await seedSuperAdmin()
      await mongoose.disconnect()
      console.log('Déconnecté')
      process.exit(0)
    })
    .catch(err => {
      console.error('Connexion MongoDB échouée :', err.message)
      process.exit(1)
    })
}