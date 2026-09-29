<?php
declare(strict_types=1);

namespace Acme\Core\Plugin;

class GuardPlugin
{
    public function afterOpen($subject, $result)
    {
        return $result;
    }

    public function aroundLocked($subject, callable $proceed)
    {
        return $proceed();
    }

    public function afterMake($subject, $result)
    {
        return $result;
    }

    public function beforeSecret($subject)
    {
        return null;
    }

    public function afterMissing($subject, $result)
    {
        return $result;
    }

    public function afterRun($subject, $result)
    {
        return $result;
    }
}
