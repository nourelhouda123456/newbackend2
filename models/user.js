import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Le nom est obligatoire'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "L'email est obligatoire"],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    // Non obligatoire pour les comptes Google OAuth
    required: false,
    minlength: 6,
    select: false,
  },
  // Google OAuth
  googleId: {
    type: String,
    default: null,
    sparse: true, // permet d'avoir plusieurs documents sans googleId
  },
  avatar: {
    type: String,
    default: null,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  active: {
    type: Boolean,
    default: true,
  },
  fcmToken: {
    type: String,
    default: null,
  },
}, { timestamps: true })

// Hash du mot de passe avant sauvegarde (seulement si un mot de passe existe)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

// Méthode de comparaison du mot de passe
userSchema.methods.comparePassword = function (plain) {
  if (!this.password) return Promise.resolve(false)
  return bcrypt.compare(plain, this.password)
}

// Activer la conversion de _id en id lors de la sérialisation JSON
userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    if (ret._id) ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    delete ret.password
    return ret
  }
})

userSchema.set('toObject', {
  virtuals: true,
  transform: (doc, ret) => {
    if (ret._id) ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    delete ret.password
    return ret
  }
})

export default mongoose.model('User', userSchema)