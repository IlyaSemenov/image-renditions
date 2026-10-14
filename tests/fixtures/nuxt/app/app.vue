<script setup lang="ts">
const { url } = useRenditions()
</script>

<template>
  <RenditionImg preset="avatar" src="photo.png" alt="" />
  <RenditionImg preset="logo" src="brand/logo #1.svg" alt="" loading="eager" />
  <a :href="url('avatar', 'photo.png', { density: 2 })">2x</a>
</template>
