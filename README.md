<<<<<<< HEAD
# Fresh Veggies Backend

Backend API for Fresh Veggies e-commerce platform built with Node.js, Express, and MongoDB.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

3. Configure your `.env` file with MongoDB URI, JWT secret, and Cloudinary credentials.

4. Start development server:
```bash
npm run dev
```

5. Start production server:
```bash
npm start
```

## Environment Variables

```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/fresh-veggies
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=30d
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLIENT_URL=http://localhost:3000
```

## API Documentation

Base URL: `http://localhost:5000/api`

### Authentication Routes
- POST `/auth/register` - Register new user
- POST `/auth/login` - Login user
- GET `/auth/me` - Get current user (Protected)
- PUT `/auth/profile` - Update profile (Protected)

### Product Routes
- GET `/products` - Get all products with filters
- GET `/products/featured` - Get featured products
- GET `/products/:id` - Get single product
- POST `/products` - Create product (Admin)
- PUT `/products/:id` - Update product (Admin)
- DELETE `/products/:id` - Delete product (Admin)

### Category Routes
- GET `/categories` - Get all categories
- GET `/categories/:id` - Get single category
- POST `/categories` - Create category (Admin)
- PUT `/categories/:id` - Update category (Admin)
- DELETE `/categories/:id` - Delete category (Admin)

### Combo Routes
- GET `/combos` - Get all combos
- GET `/combos/:id` - Get single combo
- POST `/combos` - Create combo (Admin)
- PUT `/combos/:id` - Update combo (Admin)
- DELETE `/combos/:id` - Delete combo (Admin)

### Order Routes
- POST `/orders` - Create order (Protected)
- GET `/orders/myorders` - Get user orders (Protected)
- GET `/orders/:id` - Get single order (Protected)
- GET `/orders` - Get all orders (Admin)
- PUT `/orders/:id/status` - Update order status (Admin)
- PUT `/orders/:id/cancel` - Cancel order (Protected)

### Admin Routes
- GET `/admin/stats` - Get dashboard statistics (Admin)
- GET `/admin/users` - Get all users (Admin)
- PUT `/admin/users/:id/role` - Update user role (Admin)
- DELETE `/admin/users/:id` - Delete user (Admin)

### Upload Routes
- POST `/upload` - Upload image to Cloudinary (Admin)
- DELETE `/upload/:publicId` - Delete image from Cloudinary (Admin)

## Database Models

### User
- name, email, phone, password
- address (street, city, state, pincode)
- role (customer/admin)
- isActive status

### Category
- name, slug, description
- parentCategory (for nested categories)
- image, isActive status

### Product
- name, categoryId, price, weight
- stock, description, images
- features, howToGrow, season
- isCombo, isActive, rating

### Combo
- name, description, price
- originalPrice, discount
- includedProducts array
- comboType, stock, images

### Order
- userId, orderItems array
- shippingAddress
- paymentMode, paymentStatus
- orderStatus, totalAmount
- deliveredAt, cancelledAt

## Error Handling

All routes include error handling middleware that returns:
```json
{
  "success": false,
  "message": "Error message"
}
```

## Authentication

Protected routes require JWT token in Authorization header:
```
Authorization: Bearer <token>
```

Admin routes require user role to be 'admin'.

## File Upload

Images are uploaded to Cloudinary. Supported formats: JPEG, JPG, PNG, WEBP
Maximum file size: 5MB

## Development

Run with nodemon for auto-reload:
```bash
npm run dev
```

## Production

For production deployment:
1. Set NODE_ENV=production
2. Use a process manager like PM2
3. Set up MongoDB Atlas for database
4. Configure environment variables
5. Enable CORS for your frontend domain
=======
# fresh-veggies-seeds-backend
Full-stack e-commerce platform for selling organic seeds, fertilizers, gardening kits, and combo packs with admin product management.
>>>>>>> 622f6be56923ea5b50cb926792a9a7fa71be1ed6
