import express from 'express';
import cors from "cors"
const PORT = process.env.PORT ?? 3000;
import { app as auth } from './routes/auth.routes';
// add global error handler( for route that don't exist)

const app = express();

app.use(cors());
app.use(express.json());

// routers
app.use('/auth',auth)

// Catch all Middleware
app.use((req, res) => {
    res.status(404).json({ 
        error: "Not Found", 
        path: req.originalUrl 
    });
});

app.listen(PORT ,()=>{
    console.log(`The server is running on PORT : ${PORT}`);
} );