<?php
declare(strict_types=1);

namespace Acme\Core\Model;

class Repo implements \Acme\Core\Api\RepoInterface
{
    public function save(string $id): string
    {
        return $id;
    }
}
