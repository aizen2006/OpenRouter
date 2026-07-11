import express from 'express';
import cors from "cors"
const PORT = process.env.PORT ?? 3000;

// add global error handler( for route that don't exist)

const app = express();

app.use(cors());
app.use(express.json());

// routers

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