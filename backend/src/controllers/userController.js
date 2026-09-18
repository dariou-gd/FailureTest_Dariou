import User from '../models/User.js';
import generateToken from "../utils/generateToken.js";
import { sendVerificationCode } from "../services/emailService.js";
import jwt from 'jsonwebtoken';
import Cart from '../models/Cart.js';



// POST /api/users/register - Registrar nuevo usuario
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, name, acceptedTerms } = req.body;

    if (acceptedTerms === false || acceptedTerms === 'false') {
      return res.status(400).json({ message: 'Debes aceptar los términos y condiciones para crear una cuenta' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'El email ya está registrado' });
    }

    // Use specific fields if available, otherwise fallback to name splitting or raw name
    let finalFirstName = firstName;
    let finalLastName = lastName;

    if (!finalFirstName && name) {
      const parts = name.split(' ');
      finalFirstName = parts[0];
      finalLastName = parts.slice(1).join(' ');
    }

    // Generar código de 6 dígitos
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    const user = new User({
      firstName: finalFirstName,
      lastName: finalLastName,
      name: name || `${finalFirstName} ${finalLastName}`.trim(),
      email,
      password,
      phone,
      gender: req.body.gender || 'prefiero no decirlo',
      birthDate: (req.body.dobYear && req.body.dobMonth && req.body.dobDay)
        ? new Date(`${req.body.dobYear}-${req.body.dobMonth}-${req.body.dobDay}`)
        : undefined,
      verificationCode,
      verificationCodeExpires,
      isVerified: false,
      acceptedTerms: true // If we are here and passed the check, it must be true
    });

    await user.save();

    // Enviar correo de verificación
    try {
      // Enviar correo de verificación
      await sendVerificationCode(user.email, verificationCode, 'account_verification');
      console.log(`Verification code for ${user.email}: ${verificationCode}`); // Keeping log for debug
    } catch (emailError) {
      console.error('Error enviando código de verificación:', emailError);
      // No fallamos el registro, pero el usuario deberá reenviar el código
    }

    res.status(201).json({
      message: 'verification_required',
      email: user.email,
      userId: user._id
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/users/verify - Verificar cuenta con código
export const verifyAccount = async (req, res) => {
  try {
    const { email, code } = req.body;

    const user = await User.findOne({ email }).select('+verificationCode +verificationCodeExpires');

    if (!user) {
      return res.status(400).json({ message: 'Usuario no encontrado' });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: 'La cuenta ya ha sido verificada anteriormente' });
    }

    if (user.verificationCode !== code) {
      return res.status(400).json({ message: 'Código de verificación incorrecto' });
    }

    if (user.verificationCodeExpires < Date.now()) {
      return res.status(400).json({ message: 'El código de verificación ha expirado' });
    }

    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpires = undefined;
    await user.save();

    const token = generateToken(user._id);

    // Merge session cart if sessionId provided
    const { sessionId } = req.body;
    console.log('Registration - sessionId received:', sessionId);
    if (sessionId) {
      try {
        const sessionCart = await Cart.findOne({ sessionId });
        console.log('Session cart found:', sessionCart ? `Yes, with ${sessionCart.items?.length || 0} items` : 'No');
        if (sessionCart && sessionCart.items && sessionCart.items.length > 0) {
          // Find or create user cart (using 'user' field, not 'userId')
          let userCart = await Cart.findOne({ user: user._id });
          if (!userCart) {
            userCart = new Cart({ user: user._id, items: [] });
          }

          // Merge items from session cart to user cart
          for (const sessionItem of sessionCart.items) {
            const existingItemIndex = userCart.items.findIndex(
              item => item.product.toString() === sessionItem.product.toString()
            );

            if (existingItemIndex >= 0) {
              // Item exists, increase quantity
              userCart.items[existingItemIndex].quantity += sessionItem.quantity;
            } else {
              // New item, add to cart
              userCart.items.push(sessionItem);
            }
          }

          await userCart.save();
          console.log('Cart merged successfully. User cart now has', userCart.items.length, 'items');
          // Delete session cart
          await Cart.deleteOne({ _id: sessionCart._id });
        }
      } catch (cartError) {
        console.error('Error merging carts:', cartError);
        // Don't fail registration if cart merge fails
      }
    }

    res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        gender: user.gender,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/users/login - Iniciar sesión
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        gender: user.gender,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/users/wishlist - Agregar/Eliminar de la lista de deseos
export const toggleWishlist = async (req, res) => {
  try {
    const { productId } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Convert keys to string for comparison when using indexOf
    const index = user.wishlist.indexOf(productId);

    if (index === -1) {
      user.wishlist.push(productId);
    } else {
      user.wishlist.splice(index, 1);
    }

    await user.save();

    res.json({
      message: index === -1 ? 'Producto agregado a la lista de deseos' : 'Producto eliminado de la lista de deseos',
      wishlist: user.wishlist,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/users/wishlist - Obtener lista de deseos
export const getWishlist = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('wishlist');

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(user.wishlist);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/users/profile - Obtener perfil completo
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      gender: user.gender,
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/users/profile - Actualizar perfil
export const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    user.firstName = req.body.firstName || user.firstName;
    user.lastName = req.body.lastName || user.lastName;
    user.phone = req.body.phone || user.phone;
    user.gender = req.body.gender || user.gender;

    // Auto-update combined name
    if (req.body.firstName || req.body.lastName) {
      user.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }

    if (req.body.password) {
      user.password = req.body.password;
    }

    const updatedUser = await user.save();

    res.json({
      id: updatedUser._id,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      role: updatedUser.role,
      gender: updatedUser.gender,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/users - Obtener todos los usuarios (Admin)
export const getAllUsers = async (req, res) => {
  try {
    const { role, search, minAge, maxAge, gender } = req.query;

    let query = {};

    // Filter by role
    if (role && role !== 'all') {
      query.role = role;
    }

    // Filter by gender
    if (gender && gender !== 'all') {
      query.gender = gender;
    }

    // Search by name or email
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex }
      ];
    }

    // Filter by age
    if (minAge || maxAge) {
      const today = new Date();
      let dateQuery = {};

      if (minAge) {
        const maxBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
        dateQuery.$lte = maxBirthDate;
      }

      if (maxAge) {
        const minBirthDate = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate());
        dateQuery.$gt = minBirthDate;
      }

      query.birthDate = dateQuery;
    }

    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
