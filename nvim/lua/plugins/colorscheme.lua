return {
  "ellisonleao/gruvbox.nvim",
  priority = 1000,
  config = function()
    require("gruvbox").setup({
      contrast = "hard",
      transparent_mode = true,
    })
    vim.opt.background = "dark"
    vim.cmd.colorscheme("gruvbox")
  end,
}
